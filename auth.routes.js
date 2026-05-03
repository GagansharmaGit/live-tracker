import { Router } from "express";
import crypto from "crypto";
import { jwtVerify, SignJWT } from "jose";

const router = Router();

const OIDC_ISSUER = process.env.OIDC_ISSUER;
const APP_URL = process.env.APP_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: "lax",
  maxAge: 24 * 60 * 60 * 1000
};

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

router.get("/login", (req, res) => {
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = crypto.randomBytes(16).toString("hex");

  res.cookie("oauth_flow", JSON.stringify({ verifier: codeVerifier, state }), {
    httpOnly: true, maxAge: 10 * 60 * 1000
  });

  const url = new URL(`${OIDC_ISSUER}/oauth/authorize`);
  url.searchParams.set("client_id", OIDC_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${APP_URL}/auth/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  res.redirect(url.toString());
});

router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(400).send(`Auth Error: ${error}`);

  const flowCookieStr = req.cookies["oauth_flow"];
  if (!flowCookieStr) return res.status(400).send("No oauth flow found. Stale session.");

  const flow = JSON.parse(flowCookieStr);
  if (state !== flow.state) return res.status(400).send("State mismatch");

  try {
    const tokenRes = await fetch(`${OIDC_ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: OIDC_CLIENT_ID,
        client_secret: OIDC_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/auth/callback`,
        code,
        code_verifier: flow.verifier
      })
    });

    if (!tokenRes.ok) {
        return res.status(400).send(`Exchange failed: ${await tokenRes.text()}`);
    }

    const tokens = await tokenRes.json();

    const userInfoRes = await fetch(`${OIDC_ISSUER}/userinfo`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${tokens.access_token}`
      }
    });

    if (!userInfoRes.ok) {
      return res.status(400).send(`Failed to fetch user info: ${await userInfoRes.text()}`);
    }

    const userInfo = await userInfoRes.json();

    const sessionJwt = await new SignJWT({
        sub: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name || userInfo.email,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(new TextEncoder().encode(SESSION_SECRET));

    res.clearCookie("oauth_flow");
    res.cookie("session_token", sessionJwt, COOKIE_OPTIONS);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login Successful</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; }
            .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
            button { margin-top: 1rem; padding: 0.5rem 1rem; cursor: pointer; background: #0066cc; color: white; border: none; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Login Successful!</h2>
            <p>You can now share and view live locations.</p>
            <button onclick="closeWindow()">Return to Map</button>
          </div>
          <script>
            function closeWindow() {
              try {
                if (window.opener) {
                  window.opener.postMessage('location_login_success', '*');
                }
              } catch (e) {}
              window.close();
            }
            setTimeout(closeWindow, 500);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("[Auth] Callback error:", err);
    res.status(500).send("Internal Auth Error");
  }
});

router.get("/me", async (req, res) => {
  const token = req.cookies["session_token"];
  if (!token) return res.json({ authenticated: false });

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SESSION_SECRET));
    res.json({ authenticated: true, user: payload });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

router.get("/logout", (req, res) => {
  res.clearCookie("session_token");
  res.redirect("/");
});

export default router;
