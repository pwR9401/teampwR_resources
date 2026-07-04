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
                                image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAMAAADDpiTIAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAMAUExURf///9ra2kVFRQAAABERERAQEA8PDw4ODg0NDQwMDAsLCwoKCgkJCQgICAcHBwYGBu/v76+vr29vb11dXUxMTDs7OysrKxoaGgQEBBMTExsbGyIiIikpKS8vLzY2NkdHR1hYWGlpaXp6eouLi5iYmKmpqcDAwNjY2AUFBf7+/rm5uXh4eDg4OElJSeXl5Xx8fBQUFFRUVAMDA8vLy2NjY19fXwICAmJiYmpqagEBAdLS0jU1NXV1daSkpICAgIqKipCQkJWVlaCgoMLCwqurq+Dg4La2tmVlZcrKys3NzU5OTrOzs+Tk5Dc3N7y8vPr6+mZmZlVVVfDw8H5+fh4eHkZGRjQ0NP39/dHR0aioqJOTk39/f1paWlJSUkpKSkJCQjo6OjMzMzw8PERERE1NTV5eXmdnZ42NjaOjo8/Pz9nZ2T8/P+jo6L29vXBwcGBgYFFRUWhoaHd3d52dnVlZWVZWVm1tbYWFhb+/v/j4+Onp6ZaWliMjI4aGhqenp9DQ0PT09HFxcRgYGLi4uPX19aKiooODgygoKBcXF8bGxvLy8rq6uoeHh4GBgUBAQOrq6sHBwY+PjzIyMru7u8PDwz4+PktLS1xcXCoqKmFhYaampuvr6/z8/KWlpWxsbJeXlzExMcnJyScnJ8TExLCwsNPT04mJiSAgIIKCgk9PT9/f30NDQ5+fn93d3XNzcywsLEFBQVBQUI6Ojp6enu3t7YiIiPf39/Hx8R8fH5ubm319fXl5eb6+viQkJPb29rS0tOfn58jIyHJycpSUlFtbW9TU1C0tLRYWFpKSknZ2doSEhOzs7CUlJePj47GxsbKystbW1uHh4R0dHSEhIT09Pd7e3iYmJre3t8fHxy4uLs7Oztvb2xkZGWtra8XFxdXV1e7u7oyMjKGhoUhISG5ubpycnFNTU5mZmXR0dBUVFTk5Oebm5q6urrW1tfPz8xwcHOLi4jAwMNfX1/v7+62trdzc3Ht7e/n5+czMzFdXV2RkZJqamqqqqhISEpGRkaysrFlQhRwAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZdEVYdFNvZnR3YXJlAFBhaW50Lk5FVCA1LjEuMTITAUd0AAAAuGVYSWZJSSoACAAAAAUAGgEFAAEAAABKAAAAGwEFAAEAAABSAAAAKAEDAAEAAAACAAAAMQECABEAAABaAAAAaYcEAAEAAABsAAAAAAAAAGAAAAABAAAAYAAAAAEAAABQYWludC5ORVQgNS4xLjEyAAADAACQBwAEAAAAMDIzMAGgAwABAAAAAQAAAAWgBAABAAAAlgAAAAAAAAACAAEAAgAEAAAAUjk4AAIABwAEAAAAMDEwMAAAAADZp5qVybcLXwAAJAVJREFUeF7t3XncDfXiB/Bh7NsjwmNNN5V9K1uWkp3y2ArJniJbyPKg0GKJkhY9WZIoKpESkURabZWfFFdKSUUhWm5a7u919pnPzHdmvnNmzjmP+3n/de/Md8t8nnPmzHznO4pCRERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERESO5MgpDZug7CyHKisXNkHZmXwAcmMTlJ3JByAPNkHZmXwA8mITlJ3JByAfNkHZmXwA8mMTlJ3JB6AANkHZmXwACmITlJ3JB6AQNkHZmXwACmMTlJ3JB6AINkHZmXwA0rAJys4YgPNV0QuKFb+wRMlShdLzly5Ttlz5ChdVvPhfl1S69LLLi2qLyQegsrY6paQqVatVx+MWU0NbVD4A6drqlIJq1qqNB02njrawfADqaqtTyrniSjxiqJ62uHwA6murU6ppgMfLqKG2vHwAGmmrU2q5qjEeLhNNtDXkA6Bqq1NKaVoYD5aZZtoqDMB5pBoeKnNXa+swAOePa/BICTTXVmIAzhuX4oESuVZbiwE4X7RohAdKpKW2GgNwnmhVCo+TUGttPQbgPNEGD5NYC209BuD80BaPkoV22ooMwPmhPR4lC5drKzIA54UOeJCsXKetyQCcF67Hg2QlzvkADEDq6YjHyFKGtioDcD7ohMfIkq4qA3A+yI3HyJKuKgNwHmiJh8iari4DcB7ojIfImq4uA5D9dcEjZE3/ZA8DkP1JXQRQ1dK6ygxA9tcVj5C1brrKDED2dwMeIWvldJUZgOyvLh4hazfqKjMAKax7zR4de97Uq2GDm3v36duv/4CBt3QedGu12wZXHVJTU+p2PEA2hmrqeh2AYcNv6jVi5B19h/apM2jU6DEthmEB/wwL/Ft1vfjOsb3b97mhb98+d1Ss12lck/GVWk64qmYmFk51E1tPqnbzgG74L69Rd/LANnfdPSVQeAzus9FH15VnAZjaYVrfe7CommvAv+69D4t6qsqU+6e3uWFGIexZZ2a/4s0Gz5qIdVPRA7PndC6L4xdK79/g2ptxo43Ouv68CUC7Bx/CUhoDLpmLFbzx8LyRj8h8AXbrPefRLthIKnms2eM4Zu+N1HXpRQA6zMciBk/Mxkrxun1S7zzYiyNZTy5YiI2lgkWL78iLY/XFU7pu4w/AkqexgKnGl0K9eCwd/Qy2L6Vfr2XYZJJVbZAfB+mX0bqO4w3AcmeHP6DEBbqarg2plYVNu3BPk2ex4aR54LkVODwfrdT1HV8AevTGnZaef0FT16WeL2KrrvVdtQhbT4aXVhfEkXmp7JrrX57fuXPnzmsHzCiVq7CqvqLrPa4A3IW77OR7Vdu3vHWvTcYm45JnOvaQcC84eJ7brfzFr1m2HvrrvkH//+MIQFHJu5BBT+i7l9KllqOHX6W8vhF7SaiMTTgg79R9w8kvHvcB2Pwm7nDkcd2cVAlbVubDtjxR/S3sKXEqlcHReCdrK/ZmynUAXsXNTpXdhmNwZFVpbMgzb2NfCTK3Do7EQ5V1s//F3AZgO251LvdVOAh7E9/BVrw04F3sLxGW+/jnr6p9sTsBlwF4DjfKeE83Md2Jxe9jG95Ki/Pk1I3ROAiP1eiOPZpyF4BeuE2O/naEvTewAe/pVs1IhCdwBJ7r5+hsy1UAPsBNsj7EYVjJHIvV/bADu/XVzoHYvw927cZuTbgJwB7cIu8jHIfYx/2xsj+6Ysc++mQN9u6L6luwYyMXAZiCG1zYuw4HInL5/2Fdv4zHrv2zD/v2yXzs2MhFADxxKw5E4NP9WNM/g7FzvxTHnn0zCLs2SFYA1IdxJKauS8xnZZhu6Qz/1MJ+ffQBdo6SFgD9zDSB7lKPPcdtb0LmDH2G3frqc+weJC0AqpMrsL5e/jHRBgfggyrlsFdfHbC545m8AFyIQzGK83KDC4/iELw3Avv02SYcgF7yAqAexLGgwVjDfxVwDJ5rgV367t84BJ0kBqAWjgU8cAhrJMAYHIXX3NxDj887OASdJAZgDY4FfIEVEqE/jsJjQ7BDJ2Z0anr4y5pffXpwwpH2cmtBBM3CQWglMQDqEByMznAsnhgS1yjdcDH/p47+AH5dAQvYsTy1TWYArD9uE/sLMOobHIen1mF3trKMf7/XYhkb6VYzg5IZgKM4GK1VWDpRfH2cTfbYqb0fwCYURdk2A4tZm4cNaCQzAC/jYLRKYulE+RZH4qVj2JsNwT+R5JlEP6yvkcwAHMLBaHyHhRPmShyKhzLSsDdrlb/EFsJuwpLWWmH9mGQGQDX7eAvbhWUdqv34hXfe+v24NsVf/gF3OfQeDsVD92JnNo5gA1HHsail7Vg9JqkBED+b4/jtF1rlarXWToE4saBzOhZxwseHyY9gX9Yszt7kngm/CKvHJDUAm3E0URdiUXsXm9z22PAhlnJAHMu4jcS+rFndM5eaJTkTa8ckNQDC50X/jSVttb8C2wiZLX858Udswzs3Yl/WfsL6GhWxsCXx89BJDYDu9VVa0s/LiGf0PSazgECQ1Y+mOEk+2WT1aMfVWNiSeKZDHAFImz+9w9JWXz62Z7Xkz9Io4ZN5sg/LTsIGNJy+TC1K//i0l05iV9Zex/pacguEf4fVo1wH4NQczez+Pe6e2RyhHYnGQSxow/qOp+zD5PbTqNz6BLuydgPW1zqNpS2JZ727DcDYnbpmMu/AAk500rURMwcLWtuH9fXkTpht/t3jInn9Rvead7QBS1sS33l1GQDDDNqM6ljEAdHfmuScmbuxvp7sLOafsQHPSN7faoD1dRy/JjCgGNaOchcAk9s4n2MZB/TrVUUVxXLWemN9JHnqVQrre2Y2dmVN9A0ZInVfWJwlVwF4DVsJKIGl7B3DNsKGr1rZ5puSTteAGo7VUT+sYS0d63tG5t1uqqpOw/o6UrFuiLWj3ATA/LvJxdV7UQCi1k3p0LzaO0N3Wa2hol/72EwfrGID1tDwjuQ/9pNYXysTS1sSP4snOaagM9hI0LNYzJ5tADR2z+p5yYjO/V6vjI3cgiUN5K6ZwGvVvDQXe7Jm+d02EUtbehCrR7kIQEVsI0z+7ovlf6HQltsfvXb8F2sbh1+WazgfNZB7pZIo4B44iz1Zs3zEX+7v7TasHuUiAKKvJpmXV4Y4eHTN2s4erTfar4SxGvu10RYb8Mxe7MpSAayuJTdhRrz+gYsAGOcohTyFBW0NxCb8IRuAy7ABz0heLbFaTEduyqy4JRcBEM0ukF40zu4Kjlcuxn5tVMUGPDMeu7Imng4gO2VSPPPCRQBOYhthX2NBW9WxCS9t+LTtZ4Pn1RpV52WpX8yqqnbApjxTFbuypn+3h47cNaUVWD1GPgBFsIkIudsTAddjE/HbcKbj/XPGHavezfBrwblfsFHPfIVd2ViADUTJrZpisSaPfACEM/kOY0lbXgZga4sx1Y4d8GQpQZtLy/GQnOgifEzlJyxp7TmsHyMfAOHHyRVY0pY3T+KdXt71zhudXjZ0wscALMC+bAjmBE08hQWtBd8sYk4+AM9gExE9sKStuANwennXC8OXAzzkYwDkruCrqjoHGwjYeREWs1YWG9CQD8ABbCLiDJa01RibkPFx8zreH/sgPwPQEDuzU8e4mlI72Qk4F2MLGvIB0L91TONXLGnLdQCuG9zAx7Wj/AyA/F9JvtGn9S2MwhK2Dusa0MuGAbiqV3lsyFt+BkD5DXtzIOeDw7cGVnz7fdjwZn1xp70XcQxaSQ2AsCmxHHMkZ9a64GsAFr2O3TmU9oPVPVErLXEMWtkqAFteGYBN+MHXAMg/Hxovi8tJyQ6A8GeuqU+qJeatWj4HQPIqfvz24AB0sk0A/nMl1vaNzwFQJH/ExcnmYVf5AAiPmnwAHsEmhM74+W4F5HcAJrqbRO9Obf30bYPsEYCuWNNXfgdAOezrqyL0mmLnQD4AwqMmH4CnsQlzPd0+K+6S7wFQfk3QCuhWDwSEpX4AdiZ8YTX/A6CclJ2o6pL5/F0t+QAIj5p8AJw8gvGW1UvU/ZGAACTot8C+qditQaoHQPo5YQ/0xEH44iN3r92TsfYsdmokHwDhUfMhAEVvwCqJkJgAKJl+fwjY/AAMSWoAymMToKb0moieSFAAFKWqiwv7zvXC7kzJB0B41DwPQI4kLRWXsAAoyo++vQ6zW2vsy1xSAyCcWhA0RHaZCK8kMACK8jb27o3ONtd/ouQDIDxqHgfghP8nSQIJDMDX/rwSqaTzHzJJDYDlknwPYWmXypSQvQGbsADM8+czrrbMKkfyARAeNW8DEP/bYmY0mLd8SuBJX7kp1AkLwEbJmZ0OHdph/+NfI6kBsHhjQJxv1j2++pfYElt/4F4bCQlAR3+mNmQJV14TkA+A8Kh5GYDNWFTG/Ff1T0INwgI2EhCAX/15deBY+WdakhqAkthElPt5Xy83N6z3fg7L2PA/AK9KLhrtyENLpN/K7ioAwqPmYQBcvy7slmXYlIvL7r4HQPZpVXulBt1/AntxJiUDILmcWlRf8+d6ZX9q+xyAdo2xw/g83eCm/2AfzskHIAubiJAPgKipJ7GgI+mLsZ0w2fUB/A1AVVdLmJt5//qK1b5bmoEdyEnFAMiPKaCccGGPlAqA8+M/s8/ReZd2GH5TzwVNv3tlxxvFRt4xYMDAWzoX73R007yvOxw+I37mX4b8P7ZwlrF8AARNjcNyTrQXnwGlUgAcH/9xPq5ar5WCATiBxZyoga1opNA5wMMOj//Aq7CmX+QDMAObiJAPgHlTku/DCVph+O2nIXtR0b8AZDpcuPpGbz7enZAPgPDxcK8C4GYSiOW6TgOxtA3/AuD0jSE+vrMCJTUApk3txFIOWK8VuAaL2/AtAEuwJ4FGWNFH8gHYj01EeBQAuQXwQqwvgsguyuD8XqqcdUWwJ4HaWNNHSQ2AaVMurpJbvx97IRa341cAnE9wxZo+kg/ALmwiwqMAuHj433q9cMk1un0LwEnnK1iJF/b0XFIDYNbUIqkXIYT8jo3oSD+P7VMAdmA/Yrnt17/1inwA3sQmIrwJgIv7AD9gG3qya0X7FQCZB9xqJ+wzIOUCIL/eqHiiesh7WN6OPwFohd1Ye73J8IRcDJAPwGRsIkI+AGZZkl9x2GbRcclXdfkWABfJLlW9/bkRv42/5s/Fy2cfnpKjZtE4b/yYSbkAuHjZ6/PYho7TH98x/gRAdlqKqcq5y+z/uUTOte+0iQZjSI7r4gmGfACEqw7KB8AsS22wkL2c2IbOfCxuy58AOLwK7E5a7jLlX6z4VLNVh+divzZSLgAulgIpgW1o/QdL2/MnAL49AwRKH/+i6a/YuZh8AP4Pm4iQD4BZlmQv3AcE1tATcbG0kC8B+B178dWpzvc7fPVVygVA/hPbcoH/S7GsA74EQO5Vr1645dtMHIQJ+QAIVwuXD4BZlm7GQg6I3z72bn0s64AvAZC+HumBfKvtLyilXABczZgVLYb78TNY0glfAuDiXMQLx4bgQIB8AIQvNZcPgFmW3Kylq5Y0Lqkd8EFdLOiILwGQvA7knTeq4FB0Ui4A0lfug3LqV9QO6iH/HrsQXwIwFXtJmMl/4Vi05AMgfFWrfADMsiT/4pmgXDgnfLbkK9o0fAmAUha7SZzVOBaNlAuA5OtVY96bFD3jOXtvk0dwtwR/AtAbu0mgAeIpxvIB2ItNRHgTACWON0H8XWLgLWv73rg/jjeGBfgTAIm7wd7L9RgOJyKpATD9MKmHpRLOnwB8it0kVMGOOJ4w+QCcwiYiPArAGCyVcP4EQKmB/SRU+mc4npCkBsD0w+TfWCrh7NZXdukC7CexfsiBAwqSD0AZbCLCowAoQ7FYolXCEXnEnzVBHKtuekFAPgClsIkI+QCYf5hsx2KJdhuOyCNJ/ghQn8ABBaRgACZisUR7EEfklWSf35p9tMkHQPjuYPkACL5NbsVyCfYhDsgrc2tjV4lV5HYcUWoG4GMsl2ANcUCe6YBdJZjJM9TyAbgHm4iQD4Do28TpM5Q+qYfj8Y6LmaGeGoMDSs0A3I4FE2stjsdDbp5999ApwxwR+QDMxCYi5AMg/DZxMTfc0uW4wVLcLzW3shF7S6zROJ7UDEAc6wSaWaDgFkvmlye8Mhi7S6jKX8Fw5APwPrQQ5WUALsOi8fhekQtAOo7GW21/wA4TCZdSSGoAhKcTijIHy7oXeHl2IdxoyWq9GQ9kJm0hfJNrL/IBED6K6WkAFLfTeQwO1FQUZS9utWQ3jy4+/5TC/hLqv/rRJDUAwtOJwPuCymFpd7JaBVqTmx/yEw7GQx8k/jV4evAjVz4AwvVLvA2AcsaT5fR3hR6SkVt4ajqOxTMX/Ix9JVxp/YiSGgDh6UTQUg/eFr/iTKgtuacN2uNQPHJwLfaUDPqpIfIBgATFyN/Itw6A0uIQVpBV/d1wU8VwjyWrc5M4DHa4SqTPVuoG5WEA5JsSnk6EnZFe20Ev9uZEyVvMEg9XOufqiQcfXKQblfxR+1tXX0O+KbsAKAtfxioyrok19Cjus+bHpDAXjz37I59uWPJHTRgA+Sv4tgFQlH9hHcfKab/rJJcJmaap6hFXj7z540vtuOQDkEtbXcuXACifTcZajtTdoW8G91szna8el67YRRIt1w7MwwDI3XEJcBIA5aSbF4gNegFakYzRBKger6bYQTJdoh1Z6gdAUW6XXTy0hvHVMZLLDozE+vE5WQY7sPDIlbd99OiyK2a1GH5vh55/XrKp2MjeAys8c6gAlnOtk3ZoHgbgDJa05TAAirKtofNVNvMf7YHV5d8ZUAjrx6chti9UstInWDli0boXejz21oJKV/82rl7g+aeZcjc4Yv7QtuphAORncjkOgKJkfOtstnjj7euxatCfWNBGHK9hMnoMWxd6Bataymy1bc9ddaSfpdNPeHlAmq66Fha0hy1Y2tn0CesbqYeKu313ms8cr3wm/97HgI6S6yCZzAzMNi5v2av3rsL4X6SqKy462vwKLJwqtpgM2JTrBxIWYEuW+mL1bGdhj8++nTf+t2m3nhux6bnmX/948D4skVIq4REQkXrrs840bMqKX7c6SMDp1AbrBS8trZf5mXEz1iZ/zcQjINAAK0qQeTWe7mcg+c7xFdIvsKYEmaWV3tbU67Lx6Nt6H5o8PpQ6MlbrR1vsGtm1cRPvfjwAIoHJi261w8YsaG6SKaeNv679nA8Vty042qzwjI8U5nhtGMGTco48i41Z0N4l290H96YZL6OmEEMAKqT0B1bQCByz0KdY1blfsC0L2knPDID/nsAxC9XBqs45T5n+aQwGwH8SawPNw7pOZebHpsR0lwEYAP/J3Ij8Eys71AQbsjBJW5EB8J/UuiBjt2J1J+ZhM1Z0Ex4ZAP99j2O29Hct+eeSpC4EH9BVZQD89xyO2U75lT2sX4Wp95bczNmuusoMgP/24Jid2N9+9KqOZ2zvl/9692rJyW7wom0GwH81ccwS8mTl/KPTh+ObL/5p9uaHD2/7z5Rnn3322R7bLtuxoPn0Tt+Uc/GkyTn94BiABFiBg04mmOrEACSA3IOJ/sLFIrNFADJPnI38z2wZAMnHkvxUaDeMLd4AfHJ4+cbx36/cvving1Yv79N6oeqq7c9tWt31yJ89q/57Ee4FGZtvHTpjxakV5S6cFLyCLRGAdye0nNRr9PhKf3W0f3WWzletN179zz8HcXMcDuCok8ZwqTGOAHSv2XNUyfz5CxaunF65SOGCBfdW/PZ0dyykU2Xq7NVDD+UtWLhIWuX0ymlFChXMN7P6yEniWnNXlisSee9bWp56ux0HoNWqm2fmK1CoSGBohQrkLd/kUbPz6YlN+j0Uczw4nzij4zcFChZOSytstqyqW6/gqJNlAI7MfQAyhrdPw3fy1Vdzfiae1nZ289g8jRpBlUCtRjmbnjTLwKJt/fQlV1S6z/D+TZMAnB3+UBr000g91KuVYbHsiX/oCo3eoig7I8vUNmqOpeNRUtdR0uQ13jt3GYDMCXUEv0BqdDD7W1OUjGV9MC8aBwYbZ/NvedD44MMXuzFBhgBsmTUfy4Ts3YF3W+fqAzBtqnIi+uLa+tuhcFw+0nWUNC1xXG4DcHqc4PAHDDK7mt1qmkWNwB/cqIlQ4/eVWCbgFtyAAXjpSXFH+++NnkwGQQAuPnkyZ/T/eBuAZC9+G9ILR+U2AJ+/iJV0jm/GCkq72L+sSG/93K4MhxdQIQDtLIeWb/pObWEIwJVbNEs41L9JWzJu9/XX9pQcbXBQAW4C8F+79bsOjcnQ1xji5DT4Sd0alj0dvvlLH4CqdkuKjAyuGRYGATinXcHR4wAol7+v7SoZTI+/mwDs+UE1/5KNKaBflPrL41jA1A7Nb8ITFXCvgCYAVZQ99guLHesS6wQCMO4dTei8DoDSUdtVEgjmgssHYJn9hc1GahntvMOMi7CAub2a+6DjcKeI9hNgipOT7RGx8hCAetr4eB4A5dFcmuYTbhwOJ0w6AGdmYAVTjTULNFxbBPcK/Bb9KfCw49UUNQHYan+iEXh6PPbpBAE4oH0C3/sAKFP2a9pPMO1McB3pAPTF8gL1NkRq7DZZpTPvmqy/cZuqPh59A7Tz51xiAeg+Cvel1/j+7c7lceuapZEaEIB07TebDwFQaspMDvNSrg44lCjZAAw2POha+ovWV73VqSBuVj+KVFmC8xVL97pq4sK5WydUhO3qzMgbbk/vw13q3u23X3e4iaF3TQBawwlAo4GzTm7ZsqHo17v029WLIzUgADp+BEBRrsZuEmL+xziOGMkA/G44ne8WfI4k47Is3JEz8hFwIeyYPCW846Rh1Y7I3+bdho+HN9sFtldpafg2iQbgPszTvvBFySo14afB/mXhKokPgLK0OnbkuzLX4iC0JAPwAS5UU/+u8B7j809NQ5deryjfqK52c67IP7/J2rKRh5IMK6pEv7gNhywagOXwOytteHiH8aGJYuHrQUkIgKLcneAIjLB+dF4uAOsNX+c3Rt5Huvt63FU99M/cY+P0Ue0rZGW92e2ev/MXaaSWizV3Ha6bf2lo+1b80FDLFg1XMSy2EgnAV3jTfU20G+U+eDx3f3gpCWEAAicDhvtmnvnlcezPN+lP6dYENCEXgM2Gk/NBkV33fYi76uov7k7N8fBf2zfd2luzCs4GPEEbE/rQaIfb1d6RKobpVZEAtMUwad79th4vIIeXzDcPwKlHarQ5N/D4X7H6nmuRmCvDp3boLnyakgvA+DQonD/2QXk37FLV+3V1tYp+8vEVEzr81Ryv2zQPXQr6KDdsr9wsUjMTzzYjAegJ23XLLeFKg81C/ZgF4O8GVYOXis7azVSIz8S7nP2cjsPaVdipGbkA3IGF986O7ltmuHdXXFc3pMruz1veVG1Qjer7fzC5OXhN6FtjEm4vdEGk/np820Y4AJmGD6BxS5cuXbotYOnhBrDv+dDMWJMA7A1/CyXAkOmGb03PVK4z+CT2Z04qAF8+jYXLxSbbtHsdd67QVVYUZVjrIw1yZlm8BeCS0D2E6bg9b/QK/npcQT4cgFYPwXb10Jo1a9aUDMrC6/CnQj9ETALwaqSjhPi0+Z34IeiBCkd7Gm+ui0gFYHhZLNw/cnKmKB8b0lFAP0lsdrES3Uz+6rVeCwag+xu4PXf081gUgB6GsxNLjwUrGQNwEdzFSoAzfxZ/Bofh2qE7XrvM8GpIS1IB+PEeLHw8tjMHTN9R1YLa9XoH98EPbxOhAKw/ittjLykRBaAtXm2yFvpvNAZAfMXMVyeXNb+1utx/Adqbc9ykzS5WSZQKwBjDp3eJ2M6XDD9uCs2K7swx1tFSr6EAbDiH22OLd4sC0AI22wi9D8AQgLTo9etkGLat52ujvlmD31dW6pbpP/9cre3/3eZ64FIBuE13RSfg8djOFwx3CYpET902l7W7gRwSCsDCO3F7VrQXUQDegs02tgfnIBoC8LPMI3m+qbK1x6OL/5lT6+1RxY/VeGhfvwr9f36v3P4ZJd/7+ZEbrz8+4PGXe1+5esf2xa1nnfHg/YZSATCcnGkD8Kvh+n00AIOdfrqFArDOsKRG42gvogBIvpV7ZfBIGwJQI/GnAMkmFYB/8DKAdprxGcOkp8hXwN1mH/+F/y61vwLe2wkF4IFOsFnzNmdRAFrCZhsfBs9PDQG4kwGwDMCqPFhYcw5wlWGiWMGXgju+NJ6g1y910XMttigLcZ3rUAAyDevdxB5pFwVgAmy28XbwArkhAE/qJ43+L5AKwC+GXwHVY9fLDuLRVAsEb8ctege3q/mKhy7Gn8AZfKEAVDG8J2hytBdRAD43fDhl1ajxjcjLq8y/AuoxAJYBmIDX29WnF0Z3zjLMeAq9pvgXwxLvM5qGb1AJAmA818gVfaZjPWYwHIAhuF1dEqkiZghAcQbAMgATS2DhGbGpBh1wn1oxuN0wTyfPnkiVmngFJByA5rBZzRf6MglMSMDbBOEAvGS4yTo6UkXMEIB3GABVTWuBZcKqmNyn7xab/Gm4gK9+Hdj8rOHcMPbCktOlYVc4AMvxekOh6K25hfhLNByAqYaLR9rXYpz95c5RFxfbdPWSwcsnDHnhq8jniSEAPAkMXFs499u/jN7oGnjaY0FtKJw3+kF7n2GhsiLBX6mf4YvbC8RWQpsCuyIBWIqze+tH5zQbnrSO3A00vJbrfc1v+i6hVXQq5y9davKaG/fdMFBwJbAiAxA4cOkm6v+9MfAwuOFMv1ikoWGGhvYFTxDvxl8OsW+ARR/ArkgAdn+DO3atC9cxfKFEArANZ6vXbx3pR1Gm4OdGaJ8hAGMZAKG8wbvLb+DJ9oDIggPvGh7J+zr4SWv4Zij0QaTvqYZvh3AAFhnegVO5VqhKR4xTNAALx+KeodGPgEy8SLkvdHfREIA6DIBQnmAAWuE937QjoXamRh6rjno89KRXJcMNwM7hrs9Wwz2RACh/GuYW5FqiVKmi3G/4RRENgGFOoFq3YvBp4CpV2h6DPepvoWwYAnCMARAKBUBZiR+mtY98dfZsZlHDL7fIo8iLDZcBcy/5/feMzC3LahjvD0QC8K5h7qFa93izadcb5gRrArDFeL2h9LklH/313COGz6aS4dU/DAG4gwEQCgdgomFKgNq/2vgrjfOb1oa/tQ0ngaqqvjdu5agBhk8GTQAknqaOBkAZbrgSJbIpXMMQgOcZAKFwAJSq+EPA3OTIO9yGWT6vDe6KfG3/6KwXXQCUZoY/dXNDI1UMAbiFARCKBEDZiHdwzOSJzak1/Dy08EZkKlOm4WtbRBOATJz6Z+716IuhDQG4kAEQigbAyREt8k9sPZ52EkuZNozOZHzXcNVZQBMAZZ1h0qqJ9NhzkoYAzGcAhGIB6HLUbu2GgpdoJyWKl7JOqwEtvRN7eH+Ofk8UPjKgDYDSyv6Do/D02NgYAFcBUDKvwQvyem821V1Sn2t4zidi2lK4hbM2tkhIF8Nl56AZs2GDLgDKdcXMzi018lTSzPdnANwFQFEG401ZrW/w7e2frsEiIX9MbfWzfssuzfpSRZ/S7wv5aRhs0AdAmboRLwfolGitXSuOAXAbAKVtG9Gp4P55uNyXoryEj2YFFO41VzmBHw5tNbW6vG04q5/5qvIJbIIAKErbzni1Mqr09OgCBEEMgKLsdvpGI30AlMxZTxgOT+DX35GtZndUi36I9/fU44d/V5QH8HN+pbb2+svgHm/jIYohAI0xAMqWpTfj82NBp4qdgbHBQpGq2ud/LwDXPa8WdiJtJj7pd3bI1S+mpdcPX85rVL9u3dcbNF1oWI0zpPuw7w/VrRstm6/G/cHrRN2P6HuvvE//QNPWI0+He2hUXz0wL/AFcbqRrkajAZHHkzW6Hxx/Q/7o0FS1UXp67vlN5xqe9ptbXN992v/glUCle4YzZn/YyroFTZ6c37hbmfIDbx532xTDP7DO+qW3FX+xfJkVx3s3vCn2SVwF6KoE9Jhe74b3yuVs8GCL8D4cmLFK0MmqXRt2fijrULfyQ5/v9N1BwXxvu96JiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIUsb/A1BVhhJfU4W8AAAAAElFTkSuQmCC",
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