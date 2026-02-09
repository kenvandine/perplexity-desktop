const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const { join } = require('path');
const fs = require('fs');

let tray = null;
let win = null;
let autostart = false;
let wasOffline = false;
const appURL = 'https://perplexity.ai'
const icon = nativeImage.createFromPath(join(__dirname, 'icon1024.png'));
const isTray = process.argv.includes('--tray');
const snapPath = process.env.SNAP
const snapUserData = process.env.SNAP_USER_DATA
const isScreenshotMode = process.env.TEST_SCREENSHOT === '1';
const screenshotPath = process.env.SCREENSHOT_PATH || 'screenshot.png';

function initializeAutostart() {
  if (fs.existsSync(snapUserData + '/.config/autostart/perplexity-desktop.desktop')) {
    console.log('Autostart file exists')
    autostart = true;
  } else {
    console.log('Autostart file does not exist')
    autostart = false;
  }
}

function handleAutoStartChange() {
  if (autostart) {
    console.log("Enabling autostart");
    if (!fs.existsSync(snapUserData + '/.config/autostart')) {
      fs.mkdirSync(snapUserData + '/.config/autostart', { recursive: true });
    }
    if (!fs.existsSync(snapUserData + '/.config/autostart/perplexity-desktop.desktop')) {
      fs.copyFileSync(snapPath + '/com.github.kenvandine.perplexity-desktop-autostart.desktop', snapUserData + '/.config/autostart/perplexity-desktop.desktop');
    }
  } else {
    console.log("Disabling autostart");
    if (fs.existsSync(snapUserData + '/.config/autostart/perplexity-desktop.desktop')) {
      fs.rmSync(snapUserData + '/.config/autostart/perplexity-desktop.desktop');
    }
  }
}

// IPC listeners (registered once, outside createWindow to avoid leaks)
ipcMain.on('zoom-in', () => {
  console.log('zoom-in');
  if (!win || win.isDestroyed()) {
    console.warn('zoom-in: window does not exist or is destroyed');
    return;
  }
  const currentZoom = win.webContents.getZoomLevel();
  win.webContents.setZoomLevel(currentZoom + 1);
});

ipcMain.on('zoom-out', () => {
  console.log('zoom-out');
  if (!win || win.isDestroyed()) {
    console.warn('zoom-out: window does not exist or is destroyed');
    return;
  }
  const currentZoom = win.webContents.getZoomLevel();
  win.webContents.setZoomLevel(currentZoom - 1);
});

ipcMain.on('zoom-reset', () => {
  console.log('zoom-reset');
  if (!win || win.isDestroyed()) {
    console.warn('zoom-reset: window does not exist or is destroyed');
    return;
  }
  win.webContents.setZoomLevel(0);
});

ipcMain.on('log-message', (event, message) => {
  console.log('Log from preload: ', message);
});

// Open links with default browser
ipcMain.on('open-external-link', (event, url) => {
  console.log('open-external-link: ', url);

  if (typeof url !== 'string' || !url) {
    console.warn('open-external-link: invalid URL value received');
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    console.warn('open-external-link: failed to parse URL', e);
    return;
  }

  const allowedProtocols = new Set(['http:', 'https:']);
  if (!allowedProtocols.has(parsedUrl.protocol)) {
    console.warn('open-external-link: blocked URL with disallowed protocol:', parsedUrl.protocol);
    return;
  }

  shell.openExternal(parsedUrl.toString());
});

// Retry connection from offline page
ipcMain.on('retry-connection', () => {
  console.log('Retrying connection...');
  if (!win || win.isDestroyed()) {
    console.warn('retry-connection: window does not exist or is destroyed');
    return;
  }
  wasOffline = false;
  win.loadURL(appURL);
});

// Listen for network status updates from the preload script
// Only act on transitions to avoid reload loops
ipcMain.on('network-status', (event, isOnline) => {
  console.log(`Network status: ${isOnline ? 'online' : 'offline'}`);
  if (!win || win.isDestroyed()) {
    console.warn('network-status: window does not exist or is destroyed');
    return;
  }
  if (isOnline && wasOffline) {
    wasOffline = false;
    win.loadURL(appURL);
  } else if (!isOnline && !wasOffline) {
    wasOffline = true;
    win.loadFile('offline.html');
  }
});

function createWindow () {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width, height } = primaryDisplay.bounds

  // Log geometry information for easier debugging
  console.log(`Primary Screen Geometry - Width: ${width} Height: ${height} X: ${x} Y: ${y}`);

  win = new BrowserWindow({
    width: isScreenshotMode ? 1920 : width * 0.6,
    height: isScreenshotMode ? 1080 : height * 0.8,
    x: isScreenshotMode ? undefined : x + ((width - (width * 0.6)) / 2),
    y: isScreenshotMode ? undefined : y + ((height - (height * 0.8)) / 2),
    icon: icon,
    show: isScreenshotMode ? false : !isTray, // Start hidden if --tray or screenshot mode
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
      sandbox: false
    }
  });

  win.removeMenu();

  win.on('close', (event) => {
    if (isScreenshotMode) return;
    event.preventDefault();
    win.hide();
  });

  win.loadURL(appURL);

  // Show offline page if the main-frame URL fails to load (e.g. no internet)
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.log(`did-fail-load: ${errorDescription} (${errorCode}) for ${validatedURL}`);

    // Ignore aborted/intentional navigations (e.g. redirects, will-navigate cancellations)
    if (errorCode === -3) {
      return;
    }

    // Only treat real main-frame load failures as offline
    if (!isMainFrame || !validatedURL) {
      return;
    }

    if (isScreenshotMode) {
      setTimeout(async () => {
        try {
          const image = await win.capturePage();
          fs.writeFileSync(screenshotPath, image.toPNG());
          console.log(`Screenshot of error state saved to ${screenshotPath}`);
        } catch (error) {
          console.error('Error capturing error screenshot:', error);
        }
        app.exit(1);
      }, 2000);
      return;
    }

    wasOffline = true;
    win.loadFile('offline.html');
  });

  win.webContents.on('did-finish-load', () => {
    if (isScreenshotMode) {
      console.log('Screenshot mode: waiting 5 seconds for content to render...');
      setTimeout(async () => {
        try {
          console.log('Capturing screenshot...');
          const image = await win.capturePage();
          fs.writeFileSync(screenshotPath, image.toPNG());
          console.log(`Screenshot saved to ${screenshotPath}`);
          app.quit();
        } catch (error) {
          console.error('Error capturing screenshot:', error);
          app.exit(1);
        }
      }, 5000);
    }
  });

  // Hosts allowed to navigate within the Electron window
  const allowedHosts = new Set([
    'perplexity.ai',
    'www.perplexity.ai',
    'accounts.google.com',
    'appleid.apple.com',
  ]);

  // Intercept navigation and only allow app + auth hosts in-app
  win.webContents.on('will-navigate', (event, url) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      // If URL parsing fails, allow the navigation rather than crashing.
      return;
    }

    const protocol = parsedUrl.protocol;

    // Always allow file: navigations (e.g., offline.html).
    if (protocol === 'file:') {
      return;
    }

    // Only enforce host allowlist for http/https URLs.
    if (protocol === 'http:' || protocol === 'https:') {
      const targetHost = parsedUrl.host;
      if (!allowedHosts.has(targetHost)) {
        console.log('will-navigate external: ', url);
        event.preventDefault();
        shell.openExternal(url);
      }
      return;
    }

    // For any other protocol, open externally.
    console.log('will-navigate external (non-http/https): ', url);
    event.preventDefault();
    shell.openExternal(url);
  });

  // New-window requests (window.open / target="_blank"): only keep the
  // app host in-app; open only safe http(s) URLs in the default browser,
  // and block everything else (including malformed or non-http(s) schemes).
  win.webContents.setWindowOpenHandler(({url}) => {
    console.log('windowOpenHandler: ', url);
    try {
      const parsed = new URL(url);
      const host = parsed.host;
      const protocol = parsed.protocol;
      const appHost = new URL(appURL).host;

      // Keep navigation within the app for same-host URLs
      if (host === appHost) {
        win.loadURL(url);
        return { action: 'deny' };
      }

      // Only open external URLs for safe http/https schemes
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(url);
      } else {
        console.warn('Blocked external URL with unsafe scheme:', url);
      }
    } catch (e) {
      // If URL parsing fails, deny the request instead of opening externally
      console.warn('Failed to parse URL in setWindowOpenHandler, denying:', url, e);
    }
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'r') {
      console.log('Pressed Control+R')
      event.preventDefault()
      win.loadURL(appURL);
    }
  })
}

// Ensure we're a single instance app
const firstInstance = app.requestSingleInstanceLock();

if (!firstInstance) {
  app.quit();
} else {
  app.on("second-instance", (event) => {
    console.log("second-instance");

    // If the window doesn't exist yet or has been destroyed, create it
    if (!win || win.isDestroyed()) {
      createWindow();
      return;
    }

    // Restore and show the existing window, then focus it
    if (win.isMinimized()) {
      win.restore();
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.focus();
  });
}

function createAboutWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width, height } = primaryDisplay.bounds

  const aboutWindow = new BrowserWindow({
    width: 500,
    height: 420,
    x: x + ((width - 500) / 2),
    y: y + ((height - 420) / 2),
    title: 'About',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    modal: true,  // Make the About window modal
    parent: win  // Set the main window as parent
  });

  aboutWindow.loadFile('about.html');
  aboutWindow.removeMenu();

  // Read version from package.json
  const packageJson = JSON.parse(fs.readFileSync(join(__dirname, 'package.json')));
  const appVersion = packageJson.version;
  const appDescription = packageJson.description;
  const appTitle = packageJson.title;
  const appBugsUrl = packageJson.bugs.url;
  const appHomePage = packageJson.homepage;
  const appAuthor = packageJson.author;

  // Send version to the About window
  aboutWindow.webContents.on('did-finish-load', () => {
    console.log("did-finish-load", appTitle);
    aboutWindow.webContents.send('app-version', appVersion);
    aboutWindow.webContents.send('app-description', appDescription);
    aboutWindow.webContents.send('app-title', appTitle);
    aboutWindow.webContents.send('app-bugs-url', appBugsUrl);
    aboutWindow.webContents.send('app-homepage', appHomePage);
    aboutWindow.webContents.send('app-author', appAuthor);
  });
  // Link clicks open new windows, let's force them to open links in
  // the default browser
  aboutWindow.webContents.setWindowOpenHandler(({url}) => {
    console.log('windowOpenHandler: ', url);
    shell.openExternal(url);
    return { action: 'deny' }
  });
}

ipcMain.on('get-app-metadata', (event) => {
    const packageJson = JSON.parse(fs.readFileSync(join(__dirname, 'package.json')));
    const appVersion = packageJson.version;
    const appDescription = packageJson.description;
    const appTitle = packageJson.title;
    const appBugsUrl = packageJson.bugs.url;
    const appHomePage = packageJson.homepage;
    const appAuthor = packageJson.author;
    event.sender.send('app-version', appVersion);
    event.sender.send('app-description', appDescription);
    event.sender.send('app-title', appTitle);
    event.sender.send('app-bugs-url', appBugsUrl);
    event.sender.send('app-homepage', appHomePage);
    event.sender.send('app-author', appAuthor);
});

app.on('ready', () => {
  console.log(`Electron Version: ${process.versions.electron}`);
  console.log(`App Version: ${app.getVersion()}`);

  if (!isScreenshotMode) {
    tray = new Tray(icon);
    // Ignore double click events for the tray icon
    tray.setIgnoreDoubleClickEvents(true)
    tray.on('click', () => {
      console.log("AppIndicator clicked");
      showOrHide();
    });

    // Ensure autostart is set properly at start
    initializeAutostart();

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Show/Hide Perplexity`,
        icon: icon,
        click: () => {
          showOrHide();
        }
      },
      {
        label: 'Autostart',
        type: 'checkbox',
        checked: autostart,
        click: () => {
          autostart = contextMenu.items[1].checked;
          console.log("Autostart toggled: " + autostart);
          handleAutoStartChange();
          // We need to setContextMenu to get the state changed for checked
          tray.setContextMenu(contextMenu);
        }
      },
      { type: 'separator' },
      { label: 'About',
        click: () => {
          console.log("About clicked");
	  createAboutWindow();
        }
      },
      { label: 'Quit',
        click: () => {
          console.log("Quit clicked, Exiting");
          app.exit();
        }
      },
    ]);

    tray.setToolTip('Perplexity');
    tray.setContextMenu(contextMenu);
  }

  createWindow();
});

function showOrHide() {
  console.log("showOrHide");
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
  }
}

app.on('window-all-closed', () => {
  console.log("window-all-closed");
});

app.on('activate', () => {
  console.log("ACTIVATE");
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
