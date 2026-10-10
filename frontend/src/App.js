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
const MAX_RECIPIENTS_PER_REQUEST = 10;

function App() {
  const [emailList, setEmailList] = useState([]);
  const [subject, setSubject] = useState("");
  const [msg, setMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState("info");
  const [status, setStatus] = useState(false);
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

      let records = [];

      if (Array.isArray(data)) {
        records = data;
      } else if (Array.isArray(data.history)) {
        records = data.history;
      } else if (Array.isArray(data.emails)) {
        records = data.emails;
      } else if (Array.isArray(data.data)) {
        records = data.data;
      }

      setHistory(records);
    } catch (error) {
      console.error(
        "Unable to load email history:",
        error.response?.data || error.message
      );
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

    const allowedExtensions = /\.(xlsx|xls|csv)$/i;

    if (!allowedExtensions.test(file.name)) {
      showFeedback(
        "Please upload an Excel (.xlsx, .xls) or CSV (.csv) file.",
        "error"
      );
      event.target.value = "";
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        showFeedback("The uploaded file has no worksheets.", "error");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      // Read email addresses from the first column.
      const importedEmails = rows
        .map((row) => String(row[0] ?? "").trim())
        .filter(Boolean)
        .filter(
          (email) =>
            !["email", "email address", "e-mail", "e-mail address"].includes(
              email.toLowerCase()
            )
        );

      // Remove duplicates and validate addresses.
      const uniqueEmails = [
        ...new Set(importedEmails.map((email) => email.toLowerCase())),
      ];

      const validEmails = uniqueEmails.filter((email) =>
        EMAIL_REGEX.test(email)
      );

      const invalidCount = uniqueEmails.length - validEmails.length;

      setEmailList(validEmails);
      setFileName(file.name);
      setFeedbackType(validEmails.length > 0 ? "success" : "error");

      if (validEmails.length > 0) {
        setFeedback(
          "Imported " +
            validEmails.length +
            " valid email address(es)." +
            (invalidCount > 0
              ? " Skipped " + invalidCount + " invalid address(es)."
              : "")
        );
      } else {
        setFeedback(
          "No valid email addresses were found in the first column."
        );
      }
    } catch (error) {
      console.error("File import error:", error);
      showFeedback(
        "Unable to read this file. Please check its format and try again.",
        "error"
      );
    } finally {
      event.target.value = "";
    }
  };

  const handleManualEmails = (event) => {
    const value = event.target.value;

    const emails = value
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);

    const validEmails = [
      ...new Set(
        emails
          .filter((email) => EMAIL_REGEX.test(email))
          .map((email) => email.toLowerCase())
      ),
    ];

    setEmailList(validEmails);
    setFileName("");
  };

  const clearRecipients = () => {
    setEmailList([]);
    setFileName("");
    setFeedback("");
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
      showFeedback("Please enter your email message.", "error");
      return;
    }

    setStatus(true);
    showFeedback("Sending email requests. Please wait...", "info");

    let successfulBatches = 0;
    let failedBatches = 0;
    let sentRequests = 0;

    try {
      // The backend accepts a maximum of 10 recipients per request.
      for (
        let index = 0;
        index < emailList.length;
        index += MAX_RECIPIENTS_PER_REQUEST
      ) {
        const batch = emailList.slice(
          index,
          index + MAX_RECIPIENTS_PER_REQUEST
        );

        const response = await API.post("/sendmail", {
          emailList: batch,
          subject: subject.trim(),
          msg: msg.trim(),
        });

        const result = response.data;

        if (result?.success === false) {
          failedBatches++;
          showFeedback(
            result.message || "The email request failed.",
            "error"
          );
          break;
        }

        successfulBatches++;
        sentRequests += batch.length;
      }

      if (successfulBatches > 0) {
        showFeedback(
          "Successfully submitted " +
            sentRequests +
            " recipient(s) across " +
            successfulBatches +
            " request(s)." +
            (failedBatches > 0
              ? " Some requests failed. Check the email history."
              : " Check email history for the recorded results."),
          failedBatches > 0 ? "error" : "success"
        );
      }

      if (successfulBatches === 0 && failedBatches === 0) {
        showFeedback("No email requests were submitted.", "error");
      }

      await loadHistory();
    } catch (error) {
      console.error(
        "Email sending error:",
        error.response?.data || error.message
      );

      const serverMessage = error.response?.data?.message;

      showFeedback(
        serverMessage ||
          (error.code === "ECONNABORTED"
            ? "The request timed out. Check your email history before retrying."
            : "Unable to reach the backend or email service. Check the backend logs and email history before retrying."),
        "error"
      );

      await loadHistory();
    } finally {
      setStatus(false);
    }
  };

  const getRecordRecipients = (record) => {
    if (Array.isArray(record.recipients)) {
      return record.recipients;
    }

    if (Array.isArray(record.emailList)) {
      return record.emailList;
    }

    if (Array.isArray(record.sentTo)) {
      return record.sentTo;
    }

    return [];
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return "Date unavailable";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) return "Date unavailable";

    return date.toLocaleString();
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
              Import your contacts, compose a message, and manage your
              email-sending history in one place.
            </p>
          </div>

          <div className="welcome-icon" aria-hidden="true">
            ✉
          </div>
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
              <p>Request limit</p>
              <h2>{MAX_RECIPIENTS_PER_REQUEST}</h2>
              <span className="stat-caption">Recipients per request</span>
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
                  Upload a contact file or enter addresses manually.
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
                    <strong>
                      {fileName || "Choose a contact file"}
                    </strong>
                    <small>Excel or CSV · Emails in column A</small>
                  </span>
                  <span className="browse-button">Browse</span>
                </label>
                <input
                  id="emailFile"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="file-input"
                />
              </div>

              <div className="field">
                <label htmlFor="manualEmails">
                  Or enter email addresses
                </label>
                <textarea
                  id="manualEmails"
                  rows={3}
                  placeholder="example@gmail.com, another@example.com"
                  value={emailList.join(", ")}
                  onChange={handleManualEmails}
                />
                <small className="helper-text">
                  Separate addresses with commas, spaces, or new lines.
                  Duplicates are removed automatically.
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
                  disabled={emailList.length === 0 || status}
                >
                  Clear recipients
                </button>
              </div>

              <div className="field">
                <label htmlFor="subject">Email subject</label>
                <input
                  id="subject"
                  type="text"
                  placeholder="Enter your email subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={200}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="message">Email message</label>
                <textarea
                  id="message"
                  rows={6}
                  placeholder="Write your email message here..."
                  value={msg}
                  onChange={(event) => setMsg(event.target.value)}
                  required
                />
              </div>

              <button
                className="send-button"
                type="submit"
                disabled={status || emailList.length === 0}
              >
                {status ? (
                  <>
                    <span className="spinner" />
                    Processing...
                  </>
                ) : (
                  <>
                    <span>➤</span>
                    Send email
                  </>
                )}
              </button>

              <p className="security-note">
                Email requests are processed by your backend. Check the
                history and backend logs to confirm the result.
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
                <p>
                  Upload an Excel or CSV file. Email addresses are read from
                  the first column.
                </p>
              </div>
            </div>

            <div className="guide-item">
              <span className="guide-number">02</span>
              <div>
                <h3>Compose your message</h3>
                <p>
                  Add a subject and message, then review the recipient count.
                </p>
              </div>
            </div>

            <div className="guide-item">
              <span className="guide-number">03</span>
              <div>
                <h3>Submit and review</h3>
                <p>
                  Requests are sent to your backend in groups of up to 10
                  recipients.
                </p>
              </div>
            </div>

            <div className="notice-card">
              <strong>Important</strong>
              <p>
                A saved history record does not necessarily mean an email
                was delivered. If the email service is unavailable, check
                the backend logs before trying again.
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
                Review previously submitted email requests.
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
                    const recipients = getRecordRecipients(record);
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
                          <strong>
                            {record.subject || "(No subject)"}
                          </strong>
                          <small className="history-message">
                            {record.message || ""}
                          </small>
                        </td>

                        <td>
                          {recipients.length > 0
                            ? recipients.length
                            : Array.isArray(record.sentTo)
                              ? record.sentTo.length
                              : "—"}
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
