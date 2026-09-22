import AppKit

final class FixtureDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var textView: NSTextView!
    private let outputURL = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "/tmp/syntax-native-fixture.txt")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 220, y: 180, width: 680, height: 440)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "SyntaxSenpai Native Fixture"

        let scroll = NSScrollView(frame: NSRect(origin: .zero, size: frame.size))
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        textView = NSTextView(frame: scroll.bounds)
        textView.isEditable = true
        textView.isSelectable = true
        textView.string = "initial fixture\n"
        textView.autoresizingMask = [.width]
        scroll.documentView = textView
        window.contentView = scroll

        NotificationCenter.default.addObserver(self, selector: #selector(textChanged), name: NSText.didChangeNotification, object: textView)
        installMenu()
        save()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @objc private func textChanged() { save() }

    @objc private func save() {
        try? textView.string.write(to: outputURL, atomically: true, encoding: .utf8)
    }

    @objc private func closeWindow() { window.close() }

    private func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let fileItem = NSMenuItem()
        menu.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Save", action: #selector(save), keyEquivalent: "s")
        fileMenu.addItem(withTitle: "Close", action: #selector(closeWindow), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        NSApplication.shared.mainMenu = menu
    }
}

let app = NSApplication.shared
let delegate = FixtureDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
