(function() {
        const SW_PATH = '/cdn/js/gha-sw.js';
        const CACHE_NAME = 'ghaloader';

        const style = document.createElement('style');
        style.textContent = `
        #gha-loader-root {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 450px; background: #1e1e2e; color: #cdd6f4;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 25px;
            border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 999999;
            border: 1px solid #313244;
        }
        #gha-loader-root h2 { margin-top: 0; color: #cba6f7; font-size: 22px; border-bottom: 2px solid #313244; padding-bottom: 10px; }
        .gha-field { margin-bottom: 15px; }
        .gha-field label { display: block; margin-bottom: 6px; font-size: 14px; color: #a6adc8; }
        .gha-field input, .gha-field textarea {
            width: 100%; box-sizing: border-box; background: #313244; border: 1px solid #45475a;
            color: #cdd6f4; padding: 10px; border-radius: 6px; font-size: 14px;
        }
        .gha-field textarea { height: 120px; resize: vertical; font-family: monospace; }
        #gha-load-btn {
            width: 100%; background: #a6e3a1; color: #11111b; border: none; padding: 12px;
            font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: background 0.2s;
        }
        #gha-load-btn:hover { background: #94e2d5; }
        #gha-status { margin-top: 15px; font-size: 13px; color: #fab387; text-align: center; line-height: 1.4; }
        #gha-close { position: absolute; top: 15px; right: 15px; background: none; border: none; color: #f38ba8; cursor: pointer; font-size: 16px; }
    `;
        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'gha-loader-root';
        root.innerHTML = `
        <button id="gha-close">✕</button>
        <h2>GHA Loader</h2>
        <div class="gha-field">
            <label for="gha-title">Game Title</label>
            <input type="text" id="gha-title" placeholder="e.g., Space Invaders">
        </div>
        <div class="gha-field">
            <label for="gha-html">Game HTML</label>
            <textarea id="gha-html" placeholder="<html>...</html>"></textarea>
        </div>
        <button id="gha-load-btn">Load Game</button>
        <div id="gha-status">Ready</div>
    `;
        document.body.appendChild(root);

        document.getElementById('gha-close').onclick = () => root.remove();

        const loadBtn = document.getElementById('gha-load-btn');
        const statusDiv = document.getElementById('gha-status');

        loadBtn.onclick = async () => {
                    const title = document.getElementById('gha-title').value.trim();
                    const htmlContent = document.getElementById('gha-html').value.trim();

                    if (!title || !htmlContent) {
                        statusDiv.textContent = "Error: Fields cannot be empty!";
                        return;
                    }

                    statusDiv.textContent = "Checking Service Workers...";

                    if ('serviceWorker' in navigator) {
                        try {
                            const registrations = await navigator.serviceWorker.getRegistrations();
                            for (let reg of registrations) {
                                console.log('[Main] Unregistering old instance...');
                                await reg.unregister();
                            }

                            let existingGames = [];

                            const nextIndex = existingGames.length;
                            const gamePath = `/gha/${nextIndex}`;
                            const gameEntry = {
                                id: `999${nextIndex}`,
                                title: title,
                                image: "/cdn/img/gha_loader.pngc",
                                iframeUrl: gamePath
                            };

                            existingGames.push(gameEntry);

                            const cache = await caches.open(CACHE_NAME);

                            const absoluteGameUrl = new URL(gamePath, window.location.origin).href;
                            const absoluteBackupUrl = new URL('/gha-game-db-' + nextIndex, window.location.origin).href;
                            const absoluteListUrl = new URL('/gha-game-list-json', window.location.origin).href;

                            await cache.put(absoluteGameUrl, new Response(htmlContent, {
                                headers: {
                                    'Content-Type': 'text/html'
                                }
                            }));
                            await cache.put(absoluteBackupUrl, new Response(htmlContent, {
                                headers: {
                                    'Content-Type': 'text/html'
                                }
                            }));
                            await cache.put(absoluteListUrl, new Response(JSON.stringify(existingGames), {
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            }));

                            statusDiv.textContent = "Registering approved root scope worker...";
                            const newReg = await navigator.serviceWorker.register(SW_PATH, {
                                scope: '/'
                            });

                            statusDiv.textContent = "Waiting for activation...";
                            await navigator.serviceWorker.ready;

                            const activeWorker = newReg.active || newReg.installing || newReg.waiting;
                            if (activeWorker) {
                                activeWorker.postMessage({
                                    type: 'SYNC_GAMES',
                                    games: existingGames
                                });
                            }

                            statusDiv.innerHTML = `Success! The game has been injected into Gaming Reimagined 2`

                document.getElementById('gha-title').value = '';
                document.getElementById('gha-html').value = '';

            } catch (error) {
                console.error(error);
                statusDiv.textContent = "Error occurred: " + error.message;
            }
        } else {
            statusDiv.textContent = "Error: Your browser doesn't support Service Workers.";
        }
    };
})();