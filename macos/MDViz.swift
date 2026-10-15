// mdviz.app: a native macOS window around the mdviz web UI (bundled in Contents/Resources/app).
// It opens files dropped on the Dock icon, opened with "Open With", or chosen with File > Open; saves
// exports with a save panel; and prints slides or the document to PDF.
//
// Automation (used by the build check, handy in scripts):
//   mdviz.app/Contents/MacOS/mdviz --export-pdf out.pdf [--mode slides|read] file.md …
//   mdviz.app/Contents/MacOS/mdviz --snapshot out.png [--view map] file.md …
import Cocoa
import WebKit

let markdownExts: Set<String> = ["md", "markdown", "mdx", "txt"]
let imageMime = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp"]

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var appDir: URL!
    var loaded = false
    var pending: [[String: String]] = []
    var opened = Set<String>()
    var exportTo: URL?          // --export-pdf: print to this file, then quit
    var exportMode = "slides"
    var snapshotTo: URL?        // --snapshot: save a PNG of the window's page after load, then quit
    var startView: String?      // --view
    var printTarget: URL?

    // MARK: launch

    func applicationWillFinishLaunching(_ n: Notification) {
        var args = Array(CommandLine.arguments.dropFirst())
        while let i = args.firstIndex(where: { $0.hasPrefix("-") }) {
            let flag = args.remove(at: i)
            let value = i < args.count ? args[i] : nil
            switch flag {
            case "--export-pdf": if let v = value { exportTo = URL(fileURLWithPath: v); args.remove(at: i) }
            case "--mode": if let v = value { exportMode = v; args.remove(at: i) }
            case "--snapshot": if let v = value { snapshotTo = URL(fileURLWithPath: v); args.remove(at: i) }
            case "--view": if let v = value { startView = v; args.remove(at: i) }
            default: if value != nil && !(value!.hasPrefix("-")) && flag.hasPrefix("-NS") { args.remove(at: i) }
            }
        }
        openURLs(args.map { URL(fileURLWithPath: $0) })
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        appDir = Bundle.main.resourceURL!.appendingPathComponent("app")
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "mdviz")
        if #available(macOS 12.3, *) { cfg.preferences.isElementFullscreenEnabled = true }
        if #available(macOS 13.3, *) { cfg.preferences.shouldPrintBackgrounds = true }
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "mdviz"
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = web
        window.delegate = self
        window.tabbingMode = .disallowed
        if !window.setFrameUsingName("mdviz.main") { window.center() }
        window.setFrameAutosaveName("mdviz.main")
        window.makeKeyAndOrderFront(nil)

        web.loadFileURL(appDir.appendingPathComponent("index.html"), allowingReadAccessTo: appDir)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    // Dock drop, Finder "Open With", `open -a mdviz file.md`
    func application(_ sender: NSApplication, openFiles names: [String]) {
        openURLs(names.map { URL(fileURLWithPath: $0) })
        sender.reply(toOpenOrPrint: .success)
    }

    // MARK: documents

    func openURLs(_ urls: [URL]) {
        let docs = urls.flatMap { readDocs($0.standardizedFileURL) }
        guard !docs.isEmpty else { return }
        pending += docs
        flush()
    }

    func readDocs(_ u: URL) -> [[String: String]] {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir) else { return [] }
        if isDir.boolValue {
            let items = (try? FileManager.default.contentsOfDirectory(at: u, includingPropertiesForKeys: nil)) ?? []
            return items.filter { ["md", "markdown", "mdx"].contains($0.pathExtension.lowercased()) }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
                .flatMap { readDocs($0) }
        }
        guard markdownExts.contains(u.pathExtension.lowercased()), !opened.contains(u.path),
              let text = try? String(contentsOf: u, encoding: .utf8) else { return [] }
        opened.insert(u.path)
        NSDocumentController.shared.noteNewRecentDocumentURL(u)
        return [["name": u.lastPathComponent, "text": inlineImages(text, dir: u.deletingLastPathComponent())]]
    }

    // ![alt](local.png) -> data: URI, so images next to the markdown show up
    func inlineImages(_ text: String, dir: URL) -> String {
        guard let re = try? NSRegularExpression(pattern: #"(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))"#) else { return text }
        let ns = text as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let src = ns.substring(with: m.range(at: 2))
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            last = m.range.location + m.range.length
            let path = dir.appendingPathComponent(src.removingPercentEncoding ?? src)
            if !src.contains(":"), let mime = imageMime[path.pathExtension.lowercased()], let data = try? Data(contentsOf: path) {
                out += ns.substring(with: m.range(at: 1)) + "data:\(mime);base64," + data.base64EncodedString() + ns.substring(with: m.range(at: 3))
            } else {
                out += ns.substring(with: m.range)
            }
        }
        return out + ns.substring(from: last)
    }

    func flush() {
        guard loaded, !pending.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: pending),
              let json = String(data: data, encoding: .utf8) else { return }
        pending = []
        web.evaluateJavaScript("window.MDVApp.addDocs(\(json), {only: true})") { _, err in
            if let err = err { NSLog("mdviz: addDocs failed: \(err)") }
        }
    }

    @objc func openDocument(_ sender: Any?) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = true
        p.canChooseDirectories = true
        p.canChooseFiles = true
        p.message = "Choose markdown files or a folder of them"
        p.beginSheetModal(for: window) { r in
            if r == .OK { self.opened.removeAll(); self.openURLs(p.urls) }
        }
    }

    // MARK: web view

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        loaded = true
        flush()
        if let v = startView { js("MDVApp.setView('\(v)')") }
        if let out = snapshotTo {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                self.web.takeSnapshot(with: nil) { img, _ in
                    if let img = img, let tiff = img.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                        try? png.write(to: out)
                        print("wrote \(out.path)")
                    }
                    NSApp.terminate(nil)
                }
            }
        }
        if exportTo != nil {
            // wait for the documents to render, then build the print copy
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                self.js("MDVApp.export('\(self.exportMode == "read" ? "read-pdf" : "slides-pdf")')")
            }
        }
    }

    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = a.request.url else { return decisionHandler(.cancel) }
        if u.isFileURL {
            if u.path.hasPrefix(appDir.path) { return decisionHandler(.allow) }
            openURLs([u])   // a file dropped on the page outside a drop zone
            return decisionHandler(.cancel)
        }
        if ["about", "blob", "data"].contains(u.scheme ?? "") { return decisionHandler(.allow) }
        NSWorkspace.shared.open(u)   // external links open in the default browser
        decisionHandler(.cancel)
    }

    func webView(_ w: WKWebView, runOpenPanelWith params: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = params.allowsMultipleSelection
        p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let b = m.body as? [String: Any], let type = b["type"] as? String else { return }
        let name = (b["name"] as? String) ?? "mdviz"
        switch type {
        case "open": openDocument(nil)
        case "save": save(name: name, text: (b["text"] as? String) ?? "")
        case "print": printPDF(mode: (b["mode"] as? String) ?? "view", name: name)
        default: break
        }
    }

    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

    // MARK: export

    func save(name: String, text: String) {
        let p = NSSavePanel()
        p.nameFieldStringValue = name
        p.canCreateDirectories = true
        p.beginSheetModal(for: window) { r in
            guard r == .OK, let url = p.url else { return }
            do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { NSAlert(error: error).runModal() }
        }
    }

    func printPDF(mode: String, name: String) {
        if mode == "view" { return runPrint(mode: mode, to: nil) }
        if let target = exportTo { return runPrint(mode: mode, to: target) }
        let p = NSSavePanel()
        p.nameFieldStringValue = name + (mode == "slides" ? ".slides.pdf" : ".pdf")
        p.allowedContentTypes = [.pdf]
        p.beginSheetModal(for: window) { r in
            if r == .OK, let url = p.url { self.runPrint(mode: mode, to: url) } else { self.js("MDVApp.endPrint()") }
        }
    }

    func runPrint(mode: String, to url: URL?) {
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        switch mode {
        case "slides":   // 13.333in x 7.5in, one slide per page
            info.paperSize = NSSize(width: 960, height: 540)
            info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0
        case "read":
            info.paperSize = NSSize(width: 612, height: 792)
            info.topMargin = 43; info.bottomMargin = 43; info.leftMargin = 43; info.rightMargin = 43
        default:
            info.orientation = .landscape
        }
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        if let url = url {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
        }
        printTarget = url
        let op = web.printOperation(with: info)
        op.showsPrintPanel = url == nil
        op.showsProgressPanel = url == nil
        op.view?.frame = web.bounds
        op.runModal(for: window, delegate: self, didRun: #selector(printDone(_:success:contextInfo:)), contextInfo: nil)
    }

    @objc func printDone(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        js("MDVApp.endPrint()")
        if exportTo != nil {
            print(success ? "wrote \(exportTo!.path)" : "export failed")
            NSApp.terminate(nil)
        } else if success, let t = printTarget {
            NSWorkspace.shared.activateFileViewerSelecting([t])
        }
    }

    // MARK: menu

    @objc func exportSlides(_ s: Any?) { js("MDVApp.export('slides-pdf')") }
    @objc func exportDoc(_ s: Any?) { js("MDVApp.export('read-pdf')") }
    @objc func exportDrawio(_ s: Any?) { js("MDVApp.export('drawio')") }
    @objc func exportJSON(_ s: Any?) { js("MDVApp.export('json')") }
    @objc func printView(_ s: Any?) { runPrint(mode: "view", to: nil) }
    @objc func find(_ s: Any?) { js("MDVApp.focusSearch()") }
    @objc func toggleSide(_ s: Any?) { js("MDVApp.toggleSide()") }
    @objc func reload(_ s: Any?) { opened.removeAll(); web.reload() }
    @objc func showView(_ s: NSMenuItem) { js("MDVApp.setView('\(s.representedObject as! String)')") }

    func buildMenu() {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) {
            let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let m = NSMenu(title: title)
            items.forEach { m.addItem($0) }
            it.submenu = m
            main.addItem(it)
        }
        func item(_ t: String, _ a: Selector?, _ k: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k)
            i.keyEquivalentModifierMask = mods
            if let target = target { i.target = target } else if let a = a, responds(to: a) { i.target = self }
            return i
        }
        sub("mdviz", [
            item("About mdviz", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), target: NSApp),
            .separator(),
            item("Hide mdviz", #selector(NSApplication.hide(_:)), "h", target: NSApp),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option], target: NSApp),
            .separator(),
            item("Quit mdviz", #selector(NSApplication.terminate(_:)), "q", target: NSApp),
        ])
        let recent = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        let recentMenu = NSMenu(title: "Open Recent")
        recentMenu.perform(NSSelectorFromString("_setMenuName:"), with: "NSRecentDocumentsMenu")
        recentMenu.addItem(withTitle: "Clear Menu", action: #selector(NSDocumentController.clearRecentDocuments(_:)), keyEquivalent: "")
        recent.submenu = recentMenu
        sub("File", [
            item("Open…", #selector(openDocument(_:)), "o"),
            recent,
            .separator(),
            item("Export Slides as PDF…", #selector(exportSlides(_:)), "e", [.command, .shift]),
            item("Export Document as PDF…", #selector(exportDoc(_:)), "e", [.command, .option]),
            item("Export draw.io Diagram…", #selector(exportDrawio(_:)), "d", [.command, .shift]),
            item("Export Parsed Model (JSON)…", #selector(exportJSON(_:))),
            .separator(),
            item("Print This View…", #selector(printView(_:)), "p"),
            .separator(),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
        ])
        sub("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            item("Find…", #selector(find(_:)), "f"),
        ])
        let views = ["overview", "map", "timeline", "board", "data", "graph", "slides", "read"]
        var viewItems: [NSMenuItem] = views.enumerated().map { (i, v) in
            let it = item(v.prefix(1).uppercased() + v.dropFirst(), #selector(showView(_:)), "\(i + 1)")
            it.representedObject = v
            return it
        }
        viewItems += [.separator(),
                      item("Toggle Sidebar", #selector(toggleSide(_:)), "s", [.command, .control]),
                      item("Reload", #selector(reload(_:)), "r"),
                      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])]
        sub("View", viewItems)
        let win = [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Zoom", #selector(NSWindow.performZoom(_:)))]
        sub("Window", win)
        NSApp.windowsMenu = main.items.last?.submenu
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
