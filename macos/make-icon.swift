// Draws the mdviz app icon into an .iconset folder (then: iconutil -c icns).
// usage: make-icon <out.iconset>
import Cocoa

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    // macOS icon grid: ~10% inset, ~22% corner radius
    let r = NSRect(x: s * 0.1, y: s * 0.1, width: s * 0.8, height: s * 0.8)
    let tile = NSBezierPath(roundedRect: r, xRadius: s * 0.18, yRadius: s * 0.18)
    NSGraphicsContext.current?.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
    shadow.shadowBlurRadius = s * 0.025
    shadow.shadowOffset = NSSize(width: 0, height: -s * 0.012)
    shadow.set()
    NSGradient(starting: NSColor(srgbRed: 0.16, green: 0.47, blue: 0.84, alpha: 1),
               ending: NSColor(srgbRed: 0.38, green: 0.31, blue: 0.84, alpha: 1))!.draw(in: tile, angle: -60)
    NSGraphicsContext.current?.restoreGraphicsState()

    // left: document lines; right: a small node graph
    NSColor.white.withAlphaComponent(0.95).setFill()
    let lx = r.minX + r.width * 0.13
    for (i, w) in [0.42, 0.32, 0.38, 0.26].enumerated() {
        let y = r.maxY - r.height * (0.24 + 0.15 * CGFloat(i))
        NSBezierPath(roundedRect: NSRect(x: lx, y: y, width: r.width * CGFloat(w), height: r.height * 0.065),
                     xRadius: r.height * 0.0325, yRadius: r.height * 0.0325).fill()
    }
    let nodes: [CGPoint] = [CGPoint(x: 0.70, y: 0.70), CGPoint(x: 0.84, y: 0.44), CGPoint(x: 0.60, y: 0.26), CGPoint(x: 0.66, y: 0.48)]
        .map { CGPoint(x: r.minX + r.width * $0.x, y: r.minY + r.height * $0.y) }
    let edges = NSBezierPath()
    for (a, b) in [(3, 0), (3, 1), (3, 2), (0, 1)] { edges.move(to: nodes[a]); edges.line(to: nodes[b]) }
    edges.lineWidth = max(1, s * 0.018)
    NSColor.white.withAlphaComponent(0.75).setStroke()
    edges.stroke()
    for (i, n) in nodes.enumerated() {
        let rad = s * (i == 3 ? 0.055 : 0.04)
        let dot = NSBezierPath(ovalIn: NSRect(x: n.x - rad, y: n.y - rad, width: rad * 2, height: rad * 2))
        (i == 3 ? NSColor(srgbRed: 1, green: 0.78, blue: 0.3, alpha: 1) : NSColor.white).setFill()
        dot.fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
    try! draw(base).write(to: out.appendingPathComponent("icon_\(base)x\(base).png"))
    try! draw(base * 2).write(to: out.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
