// ASCII Wallpaper: plays ascii.rest scenes as a live desktop background.
// One borderless window per display sits at desktop level, under the Finder's
// icons and ignoring the mouse, with a WKWebView running the scene.
import AppKit
import ServiceManagement
import WebKit

private let sceneKey = "scene"
private let rotateKey = "rotateMinutes"
private let rotateChoices = [0, 5, 15, 30, 60]

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, WKNavigationDelegate {
    private let webDir = Bundle.main.resourceURL!.appendingPathComponent("web")
    private var scenes: [String] = []
    private var windows: [NSWindow] = []
    private var statusItem: NSStatusItem!
    private var rotateTimer: Timer?
    private let defaults = UserDefaults.standard

    private var scene: String {
        get {
            let saved = defaults.string(forKey: sceneKey) ?? ""
            return scenes.contains(saved) ? saved : scenes[0]
        }
        set { defaults.set(newValue, forKey: sceneKey) }
    }

    private var rotateMinutes: Int {
        get { defaults.integer(forKey: rotateKey) }
        set { defaults.set(newValue, forKey: rotateKey) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let list = (try? String(contentsOf: webDir.appendingPathComponent("scenes.txt"), encoding: .utf8)) ?? ""
        scenes = list.split(separator: "\n").map(String.init)
        guard !scenes.isEmpty else { fatalError("no scenes in \(webDir.path)/scenes.txt") }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "circle.grid.3x3", accessibilityDescription: "ASCII Wallpaper")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        buildWindows()
        scheduleRotation()
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    // MARK: Windows

    @objc private func screensChanged() {
        buildWindows()
    }

    private func buildWindows() {
        windows.forEach { $0.close() }
        windows = NSScreen.screens.map(makeWindow)
    }

    private func makeWindow(for screen: NSScreen) -> NSWindow {
        let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.setFrame(screen.frame, display: false)
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        window.ignoresMouseEvents = true
        window.hasShadow = false
        window.isReleasedWhenClosed = false
        window.backgroundColor = .black

        let config = WKWebViewConfiguration()
        // The page reads the scene to start with before its script runs, so there is no flash of another one.
        config.userContentController.addUserScript(WKUserScript(
            source: "window.wallpaperScene = \(jsString(scene));",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: window.contentLayoutRect, configuration: config)
        web.navigationDelegate = self
        web.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)
        window.contentView = web
        window.orderFront(nil)
        return window
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The web process can be killed under memory pressure; start over with the current scene.
        buildWindows()
    }

    // MARK: Scenes

    private func show(_ name: String) {
        scene = name
        for window in windows {
            (window.contentView as? WKWebView)?.evaluateJavaScript("wallpaper.show(\(jsString(name)))")
        }
    }

    @objc private func pickScene(_ sender: NSMenuItem) {
        show(sender.representedObject as! String)
        scheduleRotation()
    }

    @objc private func nextScene() {
        let i = scenes.firstIndex(of: scene) ?? 0
        show(scenes[(i + 1) % scenes.count])
        scheduleRotation()
    }

    private func scheduleRotation() {
        rotateTimer?.invalidate()
        rotateTimer = nil
        guard rotateMinutes > 0 else { return }
        rotateTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(rotateMinutes * 60), repeats: true) { [weak self] _ in
            guard let self else { return }
            show(scenes.filter { $0 != self.scene }.randomElement() ?? scene)
        }
    }

    @objc private func pickRotation(_ sender: NSMenuItem) {
        rotateMinutes = sender.tag
        scheduleRotation()
    }

    // MARK: Login item

    @objc private func toggleLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
            } else {
                try service.register()
            }
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "Não foi possível alterar o item de login"
            alert.runModal()
        }
    }

    // MARK: Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        for name in scenes {
            let item = NSMenuItem(title: name.replacingOccurrences(of: "-", with: " "), action: #selector(pickScene), keyEquivalent: "")
            item.target = self
            item.representedObject = name
            item.state = name == scene ? .on : .off
            menu.addItem(item)
        }
        menu.addItem(.separator())

        let next = NSMenuItem(title: "Próxima cena", action: #selector(nextScene), keyEquivalent: "")
        next.target = self
        menu.addItem(next)

        let rotate = NSMenuItem(title: "Trocar automaticamente", action: nil, keyEquivalent: "")
        let rotateMenu = NSMenu()
        for minutes in rotateChoices {
            let title = minutes == 0 ? "Nunca" : minutes < 60 ? "A cada \(minutes) min" : "A cada \(minutes / 60) h"
            let item = NSMenuItem(title: title, action: #selector(pickRotation), keyEquivalent: "")
            item.target = self
            item.tag = minutes
            item.state = minutes == rotateMinutes ? .on : .off
            rotateMenu.addItem(item)
        }
        rotate.submenu = rotateMenu
        menu.addItem(rotate)

        let login = NSMenuItem(title: "Abrir ao iniciar sessão", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)

        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Sair", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }
}

/// A Swift string as a JavaScript string literal.
private func jsString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    return String(data: data, encoding: .utf8)!.dropFirst().dropLast().description
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
