
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import "./App.css";

const API_URL = (
  process.env.REACT_APP_API_URL ||
  "https://pandiselvi-bulkmail-7.onrender.com"
).replace(/\/+$/, "");

const API = axios.create({
  baseURL: API_URL,
  timeout: 60000,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;

function App() {
  const [emailList, setEmailList] = useState([]);
  const [subject, setSubject] = useState("");
  const [msg, setMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState("info");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const showFeedback = (message, type = "info") => {
    setFeedback(message);
    setFeedbackType(type);
  };

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const response = await API.get("/history");
      const data = response.data;

      if (Array.isArray(data)) {
        setHistory(data);
      } else if (Array.isArray(data.history)) {
        setHistory(data.history);
      } else if (Array.isArray(data.emails)) {
        setHistory(data.emails);
      } else if (Array.isArray(data.data)) {
        setHistory(data.data);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error("History loading failed:", error.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      showFeedback("Please upload an Excel or CSV file.", "error");
      event.target.value = "";
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        showFeedback("The file contains no worksheet.", "error");
        return;
      }

      const rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[sheetName],
        {
          header: 1,
          raw: false,
          defval: "",
        }
      );

      const importedEmails = rows
        .map((row) => String(row[0] ?? "").trim())
        .filter(Boolean)
        .filter(
          (email) =>
            ![
              "email",
              "email address",
              "e-mail",
              "e-mail address",
            ].includes(email.toLowerCase())
        );

      const uniqueEmails = [
        ...new Set(importedEmails.map((email) => email.toLowerCase())),
      ];

      // Use the validated list directly: no unused variable.
      const validatedEmails = uniqueEmails.filter((email) =>
        EMAIL_REGEX.test(email)
      );

      const invalidCount = uniqueEmails.length - validatedEmails.length;

      setEmailList(validatedEmails);
      setFileName(file.name);

      if (validatedEmails.length > 0) {
        showFeedback(
          "Imported " +
            validatedEmails.length +
            " valid email address(es)." +
            (invalidCount
              ? " Skipped " + invalidCount + " invalid address(es)."
              : ""),
          "success"
        );
      } else {
        showFeedback("No valid email addresses were found.", "error");
      }
    } catch (error) {
      console.error("File import failed:", error);
      showFeedback("Unable to read the file. Please try another file.", "error");
    } finally {
      event.target.value = "";
    }
  };

  const handleManualEmails = (event) => {
    const enteredEmails = event.target.value
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);

    const validList = [
      ...new Set(
        enteredEmails
          .filter((email) => EMAIL_REGEX.test(email))
          .map((email) => email.toLowerCase())
      ),
    ];

    setEmailList(validList);
    setFileName("");
  };

  const clearRecipients = () => {
    setEmailList([]);
    setFileName("");
    showFeedback("Recipient list cleared.", "info");
  };

  const handleSend = async (event) => {
    event.preventDefault();

    if (emailList.length === 0) {
      showFeedback("Please upload a file or enter valid email addresses.", "error");
      return;
    }

    if (!subject.trim()) {
      showFeedback("Please enter an email subject.", "error");
      return;
    }

    if (!msg.trim()) {
      showFeedback("Please enter an email message.", "error");
      return;
    }

    setSending(true);
    showFeedback("Submitting your email requests...", "info");

    let completedRecipients = 0;
    let failedBatches = 0;

    try {
      for (let i = 0; i < emailList.length; i += MAX_RECIPIENTS) {
        const batch = emailList.slice(i, i + MAX_RECIPIENTS);

        const response = await API.post("/sendmail", {
          emailList: batch,
          subject: subject.trim(),
          msg: msg.trim(),
        });

        if (response.data?.success === false) {
          failedBatches++;
          showFeedback(
            response.data.message || "The email request failed.",
            "error"
          );
          break;
        }

        completedRecipients += batch.length;
      }

      if (completedRecipients > 0) {
        showFeedback(
          "Submitted requests for " +
            completedRecipients +
            " recipient(s). Check email history for actual sending results." +
            (failedBatches ? " Some requests failed." : ""),
          failedBatches ? "error" : "success"
        );
      }

      await loadHistory();
    } catch (error) {
      console.error(
        "Email request failed:",
        error.response?.data || error.message
      );

      showFeedback(
        error.response?.data?.message ||
          "Email service is unavailable. Check the backend logs and history before retrying.",
        "error"
      );

      await loadHistory();
    } finally {
      setSending(false);
    }
  };

  const getRecipients = (record) => {
    if (Array.isArray(record.recipients)) return record.recipients;
    if (Array.isArray(record.emailList)) return record.emailList;
    if (Array.isArray(record.sentTo)) return record.sentTo;
    return [];
  };

  const formatDate = (value) => {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString();
  };

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="BulkMail home">
          <span className="brand-icon">B</span>
          <span>BulkMail</span>
        </a>
        <span className="topbar-label">Email Campaign Dashboard</span>
      </header>

      <main className="container">
        <section className="welcome">
          <div>
            <p className="eyebrow">EMAIL MANAGEMENT</p>
            <h1>Send emails smarter.</h1>
            <p className="welcome-text">
              Import contacts, compose messages, and manage your email
              request history from one dashboard.
            </p>
          </div>
          <div className="welcome-icon" aria-hidden="true">✉</div>
        </section>

        <section className="stats">
          <article className="stat-card">
            <span className="stat-icon purple">✉</span>
            <div>
              <p>Valid recipients</p>
              <h2>{emailList.length}</h2>
            </div>
          </article>

          <article className="stat-card">
            <span className="stat-icon blue">▤</span>
            <div>
              <p>History records</p>
              <h2>{history.length}</h2>
            </div>
          </article>

          <article className="stat-card">
            <span className="stat-icon green">✓</span>
            <div>
              <p>Recipients per request</p>
              <h2>{MAX_RECIPIENTS}</h2>
            </div>
          </article>
        </section>

        {feedback && (
          <div
            className={"feedback " + feedbackType}
            role="status"
            aria-live="polite"
          >
            <span>{feedback}</span>
            <button
              type="button"
              className="feedback-close"
              onClick={() => setFeedback("")}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        <section className="content-grid">
          <div className="panel compose-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CAMPAIGN</p>
                <h2>Compose email</h2>
                <p className="panel-description">
                  Upload contacts or enter email addresses manually.
                </p>
              </div>
              <span className="heading-icon">✎</span>
            </div>

            <form onSubmit={handleSend}>
              <div className="field">
                <label htmlFor="emailFile">Upload Excel or CSV file</label>
                <label className="upload-box" htmlFor="emailFile">
                  <span className="upload-icon">↑</span>
                  <span>
                    <strong>{fileName || "Choose a contact file"}</strong>
                    <small>Excel or CSV · Emails in column A</small>
                  </span>
                  <span className="browse-button">Browse</span>
                </label>
                <input
                  id="emailFile"
                  className="file-input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                />
              </div>

              <div className="field">
                <label htmlFor="manualEmails">Email addresses</label>
                <textarea
                  id="manualEmails"
                  rows={3}
                  placeholder="example@gmail.com, another@example.com"
                  value={emailList.join(", ")}
                  onChange={handleManualEmails}
                />
                <small className="helper-text">
                  Separate addresses with commas, spaces, or new lines.
                </small>
              </div>

              <div className="recipient-summary">
                <span>
                  <strong>{emailList.length}</strong> valid recipient(s)
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={clearRecipients}
                  disabled={sending || emailList.length === 0}
                >
                  Clear recipients
                </button>
              </div>

              <div className="field">
                <label htmlFor="subject">Email subject</label>
                <input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Enter your email subject"
                  maxLength={200}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="message">Email message</label>
                <textarea
                  id="message"
                  rows={6}
                  value={msg}
                  onChange={(event) => setMsg(event.target.value)}
                  placeholder="Write your email message..."
                  required
                />
              </div>

              <button
                className="send-button"
                type="submit"
                disabled={sending || emailList.length === 0}
              >
                {sending ? "Processing..." : "➤ Send email"}
              </button>

              <p className="security-note">
                Requests are processed by the backend. A saved history record
                does not guarantee email delivery.
              </p>
            </form>
          </div>

          <aside className="panel info-panel">
            <p className="eyebrow">QUICK GUIDE</p>
            <h2>How it works</h2>

            <div className="guide-item">
              <span className="guide-number">01</span>
              <div>
                <h3>Import contacts</h3>
                <p>Upload a spreadsheet with email addresses in column A.</p>
              </div>
            </div>

            <div className="guide-item">
              <span className="guide-number">02</span>
              <div>
                <h3>Compose a message</h3>
                <p>Enter a subject and message before submitting.</p>
              </div>
            </div>

            <div className="guide-item">
              <span className="guide-number">03</span>
              <div>
                <h3>Review history</h3>
                <p>Check recorded results after submitting requests.</p>
              </div>
            </div>

            <div className="notice-card">
              <strong>Important</strong>
              <p>
                Your current Render logs show a Gmail SMTP timeout. This
                frontend update fixes the build error but cannot fix the
                backend email connection by itself.
              </p>
            </div>
          </aside>
        </section>

        <section className="panel history-panel">
          <div className="history-heading">
            <div>
              <p className="eyebrow">ACTIVITY</p>
              <h2>Email history</h2>
              <p className="panel-description">
                Review previously submitted requests.
              </p>
            </div>

            <button
              type="button"
              className="refresh-button"
              onClick={loadHistory}
              disabled={historyLoading}
            >
              {historyLoading ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>

          {historyLoading && history.length === 0 ? (
            <div className="empty-state">Loading email history...</div>
          ) : history.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">▤</span>
              <h3>No email history yet</h3>
              <p>Your submitted email requests will appear here.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Recipients</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record, index) => {
                    const recipients = getRecipients(record);
                    const recordStatus = String(
                      record.status || "unknown"
                    ).toLowerCase();

                    return (
                      <tr
                        key={
                          record._id ||
                          record.id ||
                          record.createdAt ||
                          index
                        }
                      >
                        <td>
                          <strong>{record.subject || "(No subject)"}</strong>
                          <small className="history-message">
                            {record.message || ""}
                          </small>
                        </td>
                        <td>
                          {recipients.length ||
                            (Array.isArray(record.sentTo)
                              ? record.sentTo.length
                              : "—")}
                        </td>
                        <td>
                          <span
                            className={
                              "status-pill status-" +
                              recordStatus.replace(/[^a-z0-9-]/g, "")
                            }
                          >
                            {recordStatus}
                          </span>
                        </td>
                        <td>{formatDate(record.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>BulkMail</span>
          <span>Email management dashboard</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
