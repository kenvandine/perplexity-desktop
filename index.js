const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'icon1024.png')
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle window close
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      // On macOS, hide the window instead of closing it
      e.preventDefault();
      mainWindow.hide();
    } else {
      // On other platforms, close the app
      app.quit();
    }
  });

  // Handle window focus
  mainWindow.on('focus', () => {
    mainWindow.show();
  });

  // Handle window blur
  mainWindow.on('blur', () => {
    if (process.platform !== 'darwin') {
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create tray icon
  tray = new Tray(path.join(__dirname, 'icon1024.png'));

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide Perplexity',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      }
    },
    {
      label: 'About',
      click: () => {
        // Show about window
        const aboutWindow = new BrowserWindow({
          width: 400,
          height: 500,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
          },
          icon: path.join(__dirname, 'icon1024.png')
        });
        aboutWindow.loadFile('about.html');
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  // Set context menu
  tray.setContextMenu(contextMenu);

  // Add click handler for single click to show/hide window
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Handle macOS app activation
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Handle app quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
