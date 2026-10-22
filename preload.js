const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipc channel without exposing the entire ipcRenderer
contextBridge.exposeInMainWorld(
  'api', {
    send: (channel, data) => {
      // whitelist channels
      const validChannels = ['toMain'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel, func) => {
      const validChannels = ['fromMain'];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  }
);

// Handle authentication events
contextBridge.exposeInMainWorld(
  'auth', {
    handleAuth: (callback) => {
      // Listen for authentication events
      ipcRenderer.on('auth-event', (event, data) => {
        callback(data);
      });
    }
  }
);