namespace MemeFryer.Desktop;

/// <summary>
/// The JS half of the host bridge, injected before any page script runs.
/// Version 1 of the contract; the surface is documented in desktop/README.md.
/// </summary>
internal static class BridgeScript
{
    internal const string Source = """
        (() => {
          'use strict';
          const host = window.chrome && window.chrome.webview;
          const announce = () => window.dispatchEvent(new Event('fryerhostready'));

          if (!host) {
            window.fryerHost = Object.freeze({
              available: false,
              version: 0,
              platform: 'web',
              hostInfo: async () => ({ host: 'web', bridge: 0 }),
              openImage: async () => { throw new Error('fryerHost: no desktop host'); },
              saveImage: async () => { throw new Error('fryerHost: no desktop host'); },
              copyImage: async () => { throw new Error('fryerHost: no desktop host'); },
            });
            announce();
            return;
          }

          const pending = new Map();
          let seq = 0;

          host.addEventListener('message', (event) => {
            const reply = event.data;
            if (!reply || typeof reply !== 'object' || typeof reply.id !== 'number') return;
            const waiter = pending.get(reply.id);
            if (!waiter) return;
            pending.delete(reply.id);
            if (reply.ok) waiter.resolve(reply.result === undefined ? null : reply.result);
            else waiter.reject(new Error(reply.error || 'host error'));
          });

          const call = (command, args) => new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, { resolve, reject });
            try {
              host.postMessage({ id, command, args: args || {} });
            } catch (err) {
              pending.delete(id);
              reject(err);
            }
          });

          window.fryerHost = Object.freeze({
            available: true,
            version: 1,
            platform: 'win',
            hostInfo: () => call('hostInfo'),
            openImage: (args) => call('openImage', args),
            saveImage: (args) => call('saveImage', args),
            copyImage: (args) => call('copyImage', args),
          });

          announce();
        })();
        """;
}
