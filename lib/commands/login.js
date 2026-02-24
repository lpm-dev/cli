import http from 'node:http';
import open from 'open';
import { request } from '../api.js';
import { getRegistryUrl, setToken } from '../config.js';
import { WARNING_MESSAGES } from '../constants.js';
import { createSpinner, log, printHeader } from '../ui.js';

function getErrorHtml(title, message) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>LPM - ${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #0a0a0b;
      --bg-card: #111113;
      --bg-subtle: #18181b;
      --border: #27272a;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --error: #ef4444;
      --error-glow: rgba(239, 68, 68, 0.15);
    }

    body {
      font-family: 'Outfit', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: var(--bg-primary);
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -20%, var(--error-glow), transparent),
        radial-gradient(circle at 50% 50%, var(--bg-primary), var(--bg-primary));
      padding: 1.5rem;
    }

    .container {
      width: 100%;
      max-width: 420px;
      animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 200px;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--error), transparent);
      opacity: 0.6;
    }

    .icon-wrapper {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-circle {
      width: 64px;
      height: 64px;
      background: var(--error);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 40px var(--error-glow), 0 0 80px var(--error-glow);
      animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
    }

    @keyframes scaleIn {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }

    .x-icon {
      width: 28px;
      height: 28px;
      stroke: var(--bg-primary);
      stroke-width: 3;
      stroke-linecap: round;
      fill: none;
    }

    .title {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
      animation: fadeIn 0.5s ease-out 0.3s both;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .message {
      font-size: 0.9375rem;
      color: var(--text-secondary);
      line-height: 1.6;
      margin-bottom: 1.5rem;
      animation: fadeIn 0.5s ease-out 0.4s both;
    }

    .terminal-hint {
      padding: 0.75rem 1rem;
      background: var(--bg-subtle);
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
      animation: fadeIn 0.5s ease-out 0.5s both;
    }

    .terminal-hint code {
      color: var(--error);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="icon-wrapper">
        <div class="icon-circle">
          <svg class="x-icon" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </div>
      </div>

      <h1 class="title">${title}</h1>
      <p class="message">${message}</p>

      <div class="terminal-hint">
        Run <code>lpm login</code> in your terminal to try again
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function login() {
  printHeader();
  const registryUrl = getRegistryUrl();
  const spinner = createSpinner(`Logging in to ${registryUrl}...`).start();

  function closeAndExit(res) {
    res.on('finish', () => {
      server.close(() => process.exit(0));
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url.pathname === '/callback') {
      const token = url.searchParams.get('token');

      if (token) {
        // Use async setToken
        await setToken(token);

        try {
          const response = await request('/-/whoami');
          if (response.ok) {
            const data = await response.json();
            spinner.succeed(`Successfully logged in as: ${data.username}`);

            // Show warning if personal username is not set
            if (!data.profile_username) {
              console.log('');
              log.warn(WARNING_MESSAGES.usernameNotSet);
              log.warn(WARNING_MESSAGES.usernameNotSetHint(registryUrl));
            }

            const html = `
<!DOCTYPE html>
<html>
<head>
  <title>LPM - Access Granted</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #0a0a0b;
      --bg-card: #111113;
      --bg-subtle: #18181b;
      --border: #27272a;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #22c55e;
      --accent-glow: rgba(34, 197, 94, 0.15);
    }

    body {
      font-family: 'Outfit', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: var(--bg-primary);
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -20%, var(--accent-glow), transparent),
        radial-gradient(circle at 50% 50%, var(--bg-primary), var(--bg-primary));
      padding: 1.5rem;
    }

    .container {
      width: 100%;
      max-width: 420px;
      animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 200px;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      opacity: 0.6;
    }

    .icon-wrapper {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--accent);
      opacity: 0;
      animation: ringPulse 2s ease-out 0.3s infinite;
    }

    .icon-ring:nth-child(2) { animation-delay: 0.6s; }

    @keyframes ringPulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.8); opacity: 0; }
    }

    .icon-circle {
      width: 64px;
      height: 64px;
      background: var(--accent);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 40px var(--accent-glow), 0 0 80px var(--accent-glow);
      animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
    }

    @keyframes scaleIn {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }

    .checkmark {
      width: 32px;
      height: 32px;
      stroke: var(--bg-primary);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    .checkmark-path {
      stroke-dasharray: 50;
      stroke-dashoffset: 50;
      animation: drawCheck 0.4s ease-out 0.5s forwards;
    }

    @keyframes drawCheck {
      to { stroke-dashoffset: 0; }
    }

    .title {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
      letter-spacing: -0.02em;
      animation: fadeIn 0.5s ease-out 0.3s both;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .subtitle {
      font-size: 0.9375rem;
      color: var(--text-secondary);
      margin-bottom: 1.5rem;
      animation: fadeIn 0.5s ease-out 0.4s both;
    }

    .user-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.625rem 1rem;
      margin-bottom: 1.5rem;
      animation: fadeIn 0.5s ease-out 0.5s both;
    }

    .user-icon {
      width: 18px;
      height: 18px;
      stroke: var(--text-muted);
      stroke-width: 2;
      fill: none;
    }

    .username {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-primary);
    }

    .divider {
      height: 1px;
      background: var(--border);
      margin: 1.25rem 0;
      animation: fadeIn 0.5s ease-out 0.6s both;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      animation: fadeIn 0.5s ease-out 0.7s both;
    }

    .footer-text {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .countdown {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--accent);
      background: var(--accent-glow);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .terminal-hint {
      margin-top: 1.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-subtle);
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
      animation: fadeIn 0.5s ease-out 0.8s both;
    }

    .terminal-hint code {
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="icon-wrapper">
        <div class="icon-ring"></div>
        <div class="icon-ring"></div>
        <div class="icon-circle">
          <svg class="checkmark" viewBox="0 0 24 24">
            <path class="checkmark-path" d="M5 12l5 5L19 7"/>
          </svg>
        </div>
      </div>

      <h1 class="title">Access Granted</h1>
      <p class="subtitle">CLI authentication successful</p>

      <div class="user-badge">
        <svg class="user-icon" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>
        </svg>
        <span class="username">${data.username}</span>
      </div>

      <div class="divider"></div>

      <div class="footer" id="footer">
        <span class="footer-text">Closing in</span>
        <span class="countdown" id="countdown">5s</span>
      </div>

      <div class="terminal-hint" id="hint">
        Return to your terminal to continue using <code>lpm</code>
      </div>
    </div>
  </div>

  <script>
    let seconds = 5;
    const countdown = document.getElementById('countdown');
    const footer = document.getElementById('footer');
    const hint = document.getElementById('hint');

    const interval = setInterval(() => {
      seconds--;
      countdown.textContent = seconds + 's';
      if (seconds <= 0) {
        clearInterval(interval);
        window.close();
        // If window didn't close (browser security), show message
        setTimeout(() => {
          footer.innerHTML = '<span class="footer-text" style="color: var(--accent);">You can close this tab now</span>';
          hint.innerHTML = 'Return to your terminal to continue using <code>lpm</code>';
        }, 100);
      }
    }, 1000);
  </script>
</body>
</html>`;
            res.setHeader('Content-Type', 'text/html');
            closeAndExit(res);
            res.end(html);
          } else {
            console.error('\nToken verification failed.');
            spinner.fail('Token verification failed');
            res.setHeader('Content-Type', 'text/html');
            closeAndExit(res);
            res.end(
              getErrorHtml(
                'Invalid Token',
                'The authentication token could not be verified. Please try logging in again.',
              ),
            );
          }
        } catch (err) {
          console.error('\nError verifying token:', err.message);
          spinner.fail('Error verifying token');
          res.setHeader('Content-Type', 'text/html');
          closeAndExit(res);
          res.end(
            getErrorHtml(
              'Verification Error',
              'An error occurred while verifying your token. Please try again.',
            ),
          );
        }
      } else {
        spinner.fail('No token received');
        res.setHeader('Content-Type', 'text/html');
        closeAndExit(res);
        res.end(
          getErrorHtml(
            'No Token',
            'No authentication token was received. Please try logging in again.',
          ),
        );
      }
    } else {
      res.end('LPM CLI Login Server');
    }
  });

  server.listen(0, async () => {
    const port = server.address().port;
    // Assuming registryUrl is the base URL of the Next.js app
    const loginUrl = `${registryUrl}/cli/login?port=${port}`;

    console.log(`Opening browser to: ${loginUrl}`);
    await open(loginUrl);
    console.log('Waiting for authentication...');
  });
}
