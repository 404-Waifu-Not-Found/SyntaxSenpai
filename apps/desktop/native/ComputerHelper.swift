import AppKit
import ApplicationServices
import CoreGraphics

var targets: [String: AXUIElement] = [:]
var observedPID: pid_t = 0
var observedWindow: AXUIElement?
var observedWindowBounds: [String: Double]?
var observationID = ""
func attr(_ e: AXUIElement, _ key: String) -> CFTypeRef? { var value: CFTypeRef?; return AXUIElementCopyAttributeValue(e, key as CFString, &value) == .success ? value : nil }
func str(_ e: AXUIElement, _ key: String) -> String { return attr(e, key) as? String ?? "" }
func bounds(_ e: AXUIElement) -> [String: Double]? {
    guard let p = attr(e, kAXPositionAttribute), let s = attr(e, kAXSizeAttribute), CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point); AXValueGetValue(s as! AXValue, .cgSize, &size)
    return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
}
func trusted() throws { if !AXIsProcessTrusted() { throw NSError(domain: "Accessibility permission is unavailable for the native helper. Open Computer setup.", code: 1) } }
func focusedPID() -> pid_t? {
    let system = AXUIElementCreateSystemWide()
    guard let focused = attr(system, kAXFocusedApplicationAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
    var pid: pid_t = 0
    return AXUIElementGetPid(focused as! AXUIElement, &pid) == .success ? pid : nil
}
func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    guard let focused = attr(system, kAXFocusedUIElementAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
    return (focused as! AXUIElement)
}
func performMenuCommand(pid: pid_t, key: String) -> Bool {
    let root = AXUIElementCreateApplication(pid)
    guard let menu = attr(root, kAXMenuBarAttribute), CFGetTypeID(menu) == AXUIElementGetTypeID() else { return false }
    func find(_ element: AXUIElement, _ depth: Int) -> AXUIElement? {
        if depth > 8 { return nil }
        if str(element, kAXRoleAttribute) == kAXMenuItemRole && str(element, kAXMenuItemCmdCharAttribute).lowercased() == key.lowercased() { return element }
        for child in (attr(element, kAXChildrenAttribute) as? [AXUIElement] ?? []) {
            if let match = find(child, depth + 1) { return match }
        }
        return nil
    }
    guard let item = find(menu as! AXUIElement, 0) else { return false }
    return AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
}
func restoreObservedFocus() -> Bool {
    guard observedPID != 0, let app = NSRunningApplication(processIdentifier: observedPID) else { return false }
    let root = AXUIElementCreateApplication(observedPID)
    AXUIElementSetAttributeValue(root, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, root)
    if let window = observedWindow {
        AXUIElementSetAttributeValue(root, kAXFocusedWindowAttribute as CFString, window)
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }
    app.activate(options: [.activateAllWindows])
    for _ in 0..<10 {
        if focusedPID() == observedPID { return true }
        Thread.sleep(forTimeInterval: 0.02)
    }
    return focusedPID() == observedPID
}
func releaseInputs() {
    let source = CGEventSource(stateID: .combinedSessionState)
    for key: CGKeyCode in [54,55,56,58,59,60,61,62] { CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)?.post(tap: .cgSessionEventTap) }
    let p = CGEvent(source: nil)?.location ?? .zero
    CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cgSessionEventTap)
    CGEvent(mouseEventSource: source, mouseType: .rightMouseUp, mouseCursorPosition: p, mouseButton: .right)?.post(tap: .cgSessionEventTap)
}
func observe(_ args: [String: Any]) throws -> [String: Any] {
    try trusted()
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    let requested = args["app_id"] as? String
    let liveBundleMatch = requested.flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0).first }
    let app = requested == nil ? NSWorkspace.shared.frontmostApplication : liveBundleMatch ?? apps.first {
        $0.localizedName == requested || String($0.processIdentifier) == requested
    }
    guard let app = app else { throw NSError(domain: "Requested application is not running. Inspect apps first.", code: 2) }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    var elements: [[String: Any]] = []; targets.removeAll()
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 8 || elements.count >= 600 { return }
        let id = "e\(elements.count)"; targets[id] = e
        let role = str(e, kAXRoleAttribute), subrole = str(e, kAXSubroleAttribute)
        var entry: [String: Any] = ["id": id, "role": role, "label": [str(e, kAXTitleAttribute), str(e, kAXDescriptionAttribute)].filter { !$0.isEmpty }.joined(separator: " ")]
        if let focused = attr(e, kAXFocusedAttribute) as? Bool { entry["focused"] = focused }
        if let b = bounds(e) { entry["bounds"] = b }
        if subrole != "AXSecureTextField" { let value = str(e, kAXValueAttribute); if !value.isEmpty { entry["value"] = String(value.prefix(1500)) } }
        elements.append(entry)
        for child in (attr(e, kAXChildrenAttribute) as? [AXUIElement] ?? []) { walk(child, depth + 1) }
    }
    let window = attr(root, kAXFocusedWindowAttribute)
    if let window = window, CFGetTypeID(window) == AXUIElementGetTypeID() { observedWindow = (window as! AXUIElement); walk(observedWindow!, 0) } else { observedWindow = nil; walk(root, 0) }
    observedWindowBounds = observedWindow.flatMap { bounds($0) }
    observedPID = app.processIdentifier; observationID = UUID().uuidString
    var result: [String: Any] = ["id": observationID, "timestamp": Date().timeIntervalSince1970 * 1000, "appId": app.bundleIdentifier ?? "", "appName": app.localizedName ?? "", "pid": app.processIdentifier, "elements": elements, "apps": apps.map { ["id": $0.bundleIdentifier ?? "", "name": $0.localizedName ?? "", "pid": $0.processIdentifier] as [String: Any] }]
    if let win = observedWindow { result["windowId"] = str(win, kAXTitleAttribute); result["bounds"] = bounds(win) }
    return result
}
let keys: [String: CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"enter":36,"return":36,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,".":47,"tab":48,"space":49,"`":50,"backspace":51,"escape":53,"esc":53,"delete":117,"home":115,"end":119,"pageup":116,"pagedown":121,"left":123,"right":124,"down":125,"up":126,"f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,"f9":101,"f10":109,"f11":103,"f12":111]
func action(_ name: String, _ args: [String: Any]) throws -> [String: Any] {
    if name == "status" {
        return [
            "accessibility": AXIsProcessTrusted(),
            "postEvents": CGPreflightPostEventAccess(),
            "helperPath": CommandLine.arguments[0],
            "frontApp": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        ]
    }
    if name == "setup" {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return ["accessibility": AXIsProcessTrustedWithOptions(options), "postEvents": CGRequestPostEventAccess()]
    }
    if name == "stop" { releaseInputs(); return ["success": true] }
    if name == "observe" { return try observe(args) }
    try trusted()
    guard args["observation_id"] as? String == observationID && !observationID.isEmpty else { throw NSError(domain: "Stale observation. Observe again before acting.", code: 3) }
    if name == "focus" {
        guard let appId = args["app_id"] as? String else { throw NSError(domain: "Unknown application", code: 4) }
        let app = NSRunningApplication.runningApplications(withBundleIdentifier: appId).first ?? NSWorkspace.shared.runningApplications.first {
            $0.localizedName == appId || String($0.processIdentifier) == appId
        }
        guard let app = app else { throw NSError(domain: "Unknown application", code: 4) }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        let frontmostResult = AXUIElementSetAttributeValue(root, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetAttributeValue(system, kAXFocusedApplicationAttribute as CFString, root)
        if let window = attr(root, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() {
            let targetWindow = window as! AXUIElement
            AXUIElementSetAttributeValue(root, kAXFocusedWindowAttribute as CFString, targetWindow)
            AXUIElementPerformAction(targetWindow, kAXRaiseAction as CFString)
        }
        app.activate(options: [.activateAllWindows])
        if focusedPID() != app.processIdentifier, let bundleURL = app.bundleURL {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            configuration.createsNewApplicationInstance = false
            NSWorkspace.shared.openApplication(at: bundleURL, configuration: configuration) { _, _ in }
        }
        for _ in 0..<20 {
            if focusedPID() == app.processIdentifier { break }
            Thread.sleep(forTimeInterval: 0.05)
        }
        guard focusedPID() == app.processIdentifier else {
            throw NSError(domain: "Could not focus application (Accessibility result \(frontmostResult.rawValue)).", code: 12)
        }
        observationID = ""; return ["success": true, "action": name]
    }
    guard focusedPID() == observedPID || restoreObservedFocus() else { throw NSError(domain: "Focused application changed. Observe again.", code: 5) }
    if let expected = observedWindow {
        let root = AXUIElementCreateApplication(observedPID)
        guard let current = attr(root, kAXFocusedWindowAttribute), CFEqual(current, expected), bounds(expected) == observedWindowBounds else { throw NSError(domain: "Focused window changed. Observe again.", code: 6) }
    }
    let source = CGEventSource(stateID: .combinedSessionState)
    func mouse(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton = .left, _ count: Int64 = 1) { let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button); e?.setIntegerValueField(.mouseEventClickState, value: count); e?.post(tap: .cgSessionEventTap) }
    func point(_ prefix: String = "") throws -> CGPoint {
        if let ref = args["element_id"] as? String, prefix.isEmpty {
            guard let target = targets[ref], let b = bounds(target) else { throw NSError(domain: "Target is stale. Observe again.", code: 7) }
            return CGPoint(x: b["x"]! + b["width"]! / 2, y: b["y"]! + b["height"]! / 2)
        }
        guard let x = args[prefix + "x"] as? Double, let y = args[prefix + "y"] as? Double, x.isFinite, y.isFinite else { throw NSError(domain: "Coordinates required", code: 8) }
        return CGPoint(x: x, y: y)
    }
    switch name {
    case "click":
        if let ref = args["element_id"] as? String, let target = targets[ref] {
            AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        }
        let p = try point(); let right = args["button"] as? String == "right"
        mouse(.mouseMoved, p)
        for i in 1...max(1, min(2, args["count"] as? Int ?? 1)) { mouse(right ? .rightMouseDown : .leftMouseDown, p, right ? .right : .left, Int64(i)); mouse(right ? .rightMouseUp : .leftMouseUp, p, right ? .right : .left, Int64(i)) }
    case "type":
        let text = args["text"] as? String ?? ""
        let target = focusedElement()
        let valueBefore = target.map { str($0, kAXValueAttribute) }
        // Chunk by Character so surrogate pairs and composed characters remain intact.
        var chunk = ""
        func post(_ value: String) {
            let utf = Array(value.utf16)
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
                e?.keyboardSetUnicodeString(stringLength: utf.count, unicodeString: utf)
                e?.post(tap: .cgSessionEventTap)
                Thread.sleep(forTimeInterval: 0.01)
            }
        }
        for c in text {
            if !chunk.isEmpty && chunk.utf16.count + String(c).utf16.count > 16 { post(chunk); chunk = "" }
            chunk.append(c)
        }
        if !chunk.isEmpty { post(chunk) }
        Thread.sleep(forTimeInterval: 0.05)
        if !text.isEmpty, let target = target, str(target, kAXValueAttribute) == valueBefore {
            guard AXUIElementSetAttributeValue(target, kAXSelectedTextAttribute as CFString, text as CFString) == .success else {
                throw NSError(domain: "Keyboard input was not delivered and the focused control rejected the Accessibility fallback.", code: 13)
            }
        }
    case "key":
        let parts = (args["key"] as? String ?? "").lowercased().split(separator: "+").map(String.init)
        guard let last = parts.last, let key = keys[last] else { throw NSError(domain: "Unsupported key", code: 9) }
        var flags: CGEventFlags = []
        for modifier in parts.dropLast() { switch modifier { case "cmd", "command", "meta": flags.insert(.maskCommand); case "ctrl", "control": flags.insert(.maskControl); case "alt", "option": flags.insert(.maskAlternate); case "shift": flags.insert(.maskShift); default: throw NSError(domain: "Unsupported modifier", code: 10) } }
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)
            e?.flags = flags
            e?.post(tap: .cgSessionEventTap)
            Thread.sleep(forTimeInterval: 0.01)
        }
        Thread.sleep(forTimeInterval: 0.05)
        let modifierSet = Set(parts.dropLast())
        if modifierSet == Set(["cmd"]) || modifierSet == Set(["command"]) || modifierSet == Set(["meta"]) {
            if last == "a", let target = focusedElement() {
                let length = (str(target, kAXValueAttribute) as NSString).length
                var range = CFRange(location: 0, length: length)
                if let value = AXValueCreate(.cfRange, &range) { AXUIElementSetAttributeValue(target, kAXSelectedTextRangeAttribute as CFString, value) }
            } else if last == "s" {
                _ = performMenuCommand(pid: observedPID, key: last)
            } else if last == "w", let expected = observedWindow {
                let root = AXUIElementCreateApplication(observedPID)
                if let current = attr(root, kAXFocusedWindowAttribute), CFEqual(current, expected) { _ = performMenuCommand(pid: observedPID, key: last) }
            }
        }
    case "scroll":
        if args["x"] != nil || args["element_id"] != nil { mouse(.mouseMoved, try point()) }
        CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: Int32(max(-5000, min(5000, args["dy"] as? Int ?? -500))), wheel2: Int32(max(-5000, min(5000, args["dx"] as? Int ?? 0))), wheel3: 0)?.post(tap: .cgSessionEventTap)
    case "drag":
        let start = try point(), end = try point("to_")
        mouse(.mouseMoved, start); mouse(.leftMouseDown, start)
        defer { mouse(.leftMouseUp, end) }
        for step in 1...20 { let f = Double(step)/20; mouse(.leftMouseDragged, CGPoint(x: start.x + (end.x-start.x)*f, y: start.y + (end.y-start.y)*f)); Thread.sleep(forTimeInterval: 0.015) }
    default: throw NSError(domain: "Unknown action", code: 11)
    }
    Thread.sleep(forTimeInterval: 0.05) // Do not let the next observe overtake WindowServer delivery.
    observationID = "" // Every input invalidates its targeting basis.
    return ["success": true, "action": name]
}
while let line = readLine() {
    autoreleasepool {
        var id: Any = NSNull()
        var response: [String: Any]
        do {
            let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]; id = request["id"] ?? NSNull()
            response = ["id": id, "result": try action(request["method"] as? String ?? "", request["args"] as? [String: Any] ?? [:])]
        } catch { response = ["id": id, "error": (error as NSError).domain] }
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) { print(text); fflush(stdout) }
    }
}
releaseInputs()
