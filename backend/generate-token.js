
require("dotenv").config();

const http = require("http");
const { URL } = require("url");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = 3000;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  `http://localhost:${PORT}/oauth2callback`
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/gmail.send"],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Authorization failed. Check the terminal for details.");
    console.error("Google authorization failed:", error || "No code received");
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2>BulkMail authorization successful!</h2>" +
      "<p>You can close this browser tab and return to VS Code.</p>"
    );

    if (!tokens.refresh_token) {
      console.log(
        "No refresh token received. Run again and ensure consent is requested."
      );
    } else {
      console.log("\nYour Gmail refresh token (keep it secret):\n");
      console.log(tokens.refresh_token);
      console.log(
        "\nCopy it into your private backend .env as GMAIL_REFRESH_TOKEN=..."
      );
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Could not obtain tokens. Check the VS Code terminal.");
    console.error(
      "Token exchange failed:",
      err.response?.data || err.message
    );
  } finally {
    server.close();
  }
});

server.listen(PORT, "localhost", () => {
  console.log("1. Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\n2. Sign in to the Gmail account you want BulkMail to use.");
  console.log("3. Approve the Gmail sending permission.");
  console.log("4. Return here after authorization completes.");
});
