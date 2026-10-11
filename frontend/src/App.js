import React, { useEffect, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import "./App.css";

// Backend API URL
const API_URL = (
  process.env.REACT_APP_API_URL ||
  "https://pandiselvi-bulkmail-10.onrender.com"
).replace(/\/+$/, "");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function App() {
  const [emailList, setEmailList] = useState([]);
  const [emailInput, setEmailInput] = useState("");
  const [subject, setSubject] = useState("");
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("info");

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Display status messages.
  const showStatus = (message, type = "info") => {
    setStatus(message);
    setStatusType(type);
  };

  // Add manually entered email addresses.
  const handleAddEmails = () => {
    if (!emailInput.trim()) {
      showStatus("Please enter at least one email address.", "error");
      return;
    }

    const incoming = emailInput
      .split(/[;,\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    const valid = incoming.filter((email) => EMAIL_REGEX.test(email));
    const invalid = incoming.filter((email) => !EMAIL_REGEX.test(email));

    const existing = new Set(emailList);
    const newEmails = [...new Set(valid)].filter(
      (email) => !existing.has(email)
    );

    setEmailList((previous) => [
      ...previous,
      ...newEmails.filter((email) => !previous.includes(email)),
    ]);

    setEmailInput("");

    if (invalid.length > 0) {
      showStatus(
        `Added ${newEmails.length} new email(s). ${invalid.length} invalid address(es) were skipped.`,
        "warning"
      );
    } else if (newEmails.length === 0) {
      showStatus(
        "These email addresses are already in the recipient list.",
        "info"
      );
    } else {
      showStatus(
        `Successfully added ${newEmails.length} email address(es).`,
        "success"
      );
    }
  };

  // Import addresses from Excel or CSV without changing the design.
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setUploading(true);

    try {
      const data = await file.arrayBuffer();

      const workbook = XLSX.read(data, {
        type: "array",
      });

      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        showStatus("The selected file contains no worksheets.", "error");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      });

      const extractedEmails = rows.flatMap((row) =>
        row
          .map((cell) => String(cell).trim().toLowerCase())
          .filter((cell) => EMAIL_REGEX.test(cell))
      );

      if (extractedEmails.length === 0) {
        showStatus(
          "No valid email addresses were found. Please check your Excel or CSV file.",
          "error"
        );
        return;
      }

      const existing = new Set(emailList);
      const uniqueNewEmails = [
        ...new Set(extractedEmails),
      ].filter((email) => !existing.has(email));

      setEmailList((previous) => [
        ...previous,
        ...uniqueNewEmails.filter((email) => !previous.includes(email)),
      ]);

      showStatus(
        `Found ${new Set(extractedEmails).size} valid address(es). Added ${uniqueNewEmails.length} new recipient(s).`,
        "success"
      );
    } catch (error) {
      console.error("File upload error:", error);

      showStatus(
        "Unable to read this file. Please upload a valid Excel or CSV file.",
        "error"
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  // Remove an email address.
  const handleRemoveEmail = (emailToRemove) => {
    setEmailList((previous) =>
      previous.filter((email) => email !== emailToRemove)
    );
  };

  // Clear all recipients.
  const handleClearEmails = () => {
    setEmailList([]);
    showStatus("All recipients have been removed.", "info");
  };

  // Fetch email history from the backend.
  const fetchHistory = async () => {
    setLoadingHistory(true);

    try {
      const response = await axios.get(`${API_URL}/history`, {
        timeout: 30000,
      });

      const data = response.data;

      const records = Array.isArray(data)
        ? data
        : Array.isArray(data.history)
        ? data.history
        : Array.isArray(data.emails)
        ? data.emails
        : [];

      setHistory(records);
    } catch (error) {
      console.error(
        "History loading error:",
        error.response?.data || error.message
      );

      showStatus(
        "Unable to load email history. Check your backend connection.",
        "error"
      );
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // Fetch history when the component first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send emails in batches of 10.
  const handleSendEmails = async (event) => {
    event.preventDefault();

    if (sending) return;

    if (emailList.length === 0) {
      showStatus("Please add at least one recipient.", "error");
      return;
    }

    if (!subject.trim()) {
      showStatus("Please enter an email subject.", "error");
      return;
    }

    if (!msg.trim()) {
      showStatus("Please enter your email message.", "error");
      return;
    }

    if (emailList.length > 100) {
      showStatus(
        "Please send to no more than 100 recipients per campaign.",
        "error"
      );
      return;
    }

    const recipients = [...new Set(emailList)];
    const batches = [];

    for (let index = 0; index < recipients.length; index += 10) {
      batches.push(recipients.slice(index, index + 10));
    }

    setSending(true);

    let totalSent = 0;
    let totalFailed = 0;
    let completedBatches = 0;

    try {
      for (const batch of batches) {
        showStatus(
          `Sending batch ${completedBatches + 1} of ${batches.length}...`,
          "info"
        );

        try {
          const response = await axios.post(
            `${API_URL}/sendmail`,
            {
              emailList: batch,
              subject: subject.trim(),

              // This matches the backend code that reads req.body.msg.
              msg: msg.trim(),
            },
            {
              timeout: 120000,
            }
          );

          const data = response.data || {};

          const sent = Number(
            data.sent ??
              data.sentCount ??
              data.sentTo?.length ??
              (data.success === true ? batch.length : 0)
          );

          const failed = Number(
            data.failed ??
              data.failedCount ??
              data.failedTo?.length ??
              0
          );

          totalSent += sent;
          totalFailed += failed;

          // Do not assume success when the backend omits result counts.
          if (
            data.success === false &&
            !("failed" in data) &&
            !("failedCount" in data) &&
            !Array.isArray(data.failedTo)
          ) {
            totalFailed += Math.max(batch.length - sent, 0);
          }

          completedBatches++;
        } catch (error) {
          const responseData = error.response?.data || {};

          const sent = Number(
            responseData.sent ??
              responseData.sentCount ??
              responseData.sentTo?.length ??
              0
          );

          const failed = Number(
            responseData.failed ??
              responseData.failedCount ??
              responseData.failedTo?.length ??
              0
          );

          totalSent += sent;
          totalFailed += failed || Math.max(batch.length - sent, 0);

          completedBatches++;

          console.error(
            "Email batch error:",
            responseData.message || error.message
          );
        }
      }

      if (totalFailed === 0 && totalSent > 0) {
        showStatus(
          `The backend reported ${totalSent} email(s) sent successfully. Check your inbox and Render logs to verify delivery.`,
          "success"
        );
      } else if (totalSent > 0) {
        showStatus(
          `Sending completed with issues: ${totalSent} reported sent and ${totalFailed} failed. Check the Gmail API and Render logs.`,
          "warning"
        );
      } else {
        showStatus(
          `Email sending could not be confirmed. ${totalFailed || recipients.length} recipient(s) were not reported as sent. Check the Gmail API and Render logs.`,
          "error"
        );
      }

      await fetchHistory();
    } finally {
      setSending(false);
    }
  };

  // Determine the status displayed in history.
  const getRecordStatus = (record) => {
    const sent = Number(
      record.sentTo?.length ??
        record.successfulRecipients?.length ??
        record.sent ??
        0
    );

    const failed = Number(
      record.failedTo?.length ??
        record.failedRecipients?.length ??
        record.failed ??
        0
    );

    if (record.status === "processing") return "processing";

    if (record.status === "partial" || (sent > 0 && failed > 0)) {
      return "partial";
    }

    if (record.status === "failed" || (failed > 0 && sent === 0)) {
      return "failed";
    }

    if (record.status === "sent" && failed === 0) return "sent";

    return record.status || "processing";
  };

  // Format dates safely.
  const formatDate = (dateValue) => {
    if (!dateValue) return "—";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString();
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            ✉
          </div>

          <div>
            <h1>BulkMail</h1>
            <p>Simple, efficient bulk email management</p>
          </div>
        </div>

        <div className="header-badge">● Email Dashboard</div>
      </header>

      <main className="main-content">
        <div className="content-grid">
          {/* Left column */}
          <div className="left-column">
            {/* Recipient management */}
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Recipients</h2>
                  <p className="card-description">
                    Upload a spreadsheet or enter email addresses manually.
                  </p>
                </div>

                <span className="recipient-count">
                  {emailList.length} recipient
                  {emailList.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="form-group">
                <label className="section-label" htmlFor="email-file">
                  Import Excel or CSV
                </label>

                <input
                  id="email-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  disabled={uploading || sending}
                />

                <p className="helper-text">
                  Supported formats: .xlsx, .xls and .csv. Email addresses
                  can be in any column.
                </p>

                {uploading && (
                  <p className="helper-text">Reading your file...</p>
                )}
              </div>

              <div className="form-group">
                <label className="section-label" htmlFor="manual-emails">
                  Add email addresses manually
                </label>

                <textarea
                  id="manual-emails"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  placeholder={"example@gmail.com\nanother@example.com"}
                  rows={3}
                  disabled={sending}
                />

                <p className="helper-text">
                  Separate multiple addresses with commas, spaces or new
                  lines.
                </p>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAddEmails}
                  disabled={sending}
                  style={{ marginTop: "12px" }}
                >
                  + Add Recipients
                </button>
              </div>

              <div className="recipient-header">
                <span className="section-label" style={{ marginBottom: 0 }}>
                  Recipient list
                </span>

                {emailList.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleClearEmails}
                    disabled={sending}
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="recipient-list">
                {emailList.length === 0 ? (
                  <div className="empty-state">
                    No recipients added yet. Upload a file or enter email
                    addresses above.
                  </div>
                ) : (
                  emailList.map((email, index) => (
                    <div className="recipient-item" key={email}>
                      <span className="recipient-email">
                        <span style={{ color: "#94a3b8", marginRight: 8 }}>
                          {index + 1}.
                        </span>
                        {email}
                      </span>

                      <button
                        type="button"
                        className="remove-recipient"
                        onClick={() => handleRemoveEmail(email)}
                        disabled={sending}
                        aria-label={`Remove ${email}`}
                        title="Remove recipient"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Compose email */}
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Compose Email</h2>
                  <p className="card-description">
                    Prepare the subject and message for your recipients.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSendEmails}>
                <div className="form-group">
                  <label className="section-label" htmlFor="email-subject">
                    Email Subject
                  </label>

                  <input
                    id="email-subject"
                    type="text"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Enter your email subject"
                    maxLength={200}
                    required
                    disabled={sending}
                  />
                </div>

                <div className="form-group">
                  <label className="section-label" htmlFor="email-message">
                    Email Message
                  </label>

                  <textarea
                    id="email-message"
                    value={msg}
                    onChange={(event) => setMsg(event.target.value)}
                    placeholder="Write your email message here..."
                    rows={7}
                    required
                    disabled={sending}
                  />

                  <p className="helper-text">{msg.length} characters</p>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-full btn-send"
                  disabled={sending || uploading || emailList.length === 0}
                >
                  {sending ? (
                    <>
                      <span className="loading-spinner" />
                      Sending Emails...
                    </>
                  ) : (
                    <>✉ Send to {emailList.length} Recipient(s)</>
                  )}
                </button>

                {status && (
                  <div
                    className={`status-message status-${statusType}`}
                    role="status"
                    aria-live="polite"
                  >
                    {status}
                  </div>
                )}
              </form>
            </section>
          </div>

          {/* Right column */}
          <aside className="right-column">
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Campaign Overview</h2>
                  <p className="card-description">
                    Current email campaign details.
                  </p>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-value">{emailList.length}</span>
                  <span className="stat-label">Recipients</span>
                </div>

                <div className="stat-card">
                  <span className="stat-value">{history.length}</span>
                  <span className="stat-label">History Records</span>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">How It Works</h2>
                  <p className="card-description">
                    Send your emails in a few simple steps.
                  </p>
                </div>
              </div>

              <div className="info-card">
                <h3>Quick Guide</h3>
                <ul>
                  <li>Upload an Excel or CSV contact list.</li>
                  <li>Review the recipient list and remove unwanted entries.</li>
                  <li>Enter an email subject and message.</li>
                  <li>Send your campaign and review the results.</li>
                  <li>Check the history section for recorded results.</li>
                </ul>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Email Service</h2>
                  <p className="card-description">
                    Backend connection information.
                  </p>
                </div>
              </div>

              <div className="info-card">
                <h3>BulkMail Backend</h3>
                <p>
                  The application sends requests to your configured backend.
                  Actual sending depends on the backend response and Gmail
                  API configuration.
                </p>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-full"
                style={{ marginTop: "14px" }}
                onClick={fetchHistory}
                disabled={loadingHistory}
              >
                {loadingHistory ? "Refreshing..." : "↻ Refresh History"}
              </button>
            </section>
          </aside>
        </div>

        {/* Email history */}
        <section className="history-section">
          <div className="card history-card">
            <div className="history-header">
              <div>
                <h2 className="card-title">Email History</h2>
                <p className="card-description">
                  View email requests and recorded sending results from
                  MongoDB.
                </p>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={fetchHistory}
                disabled={loadingHistory}
              >
                {loadingHistory ? "Loading..." : "↻ Refresh"}
              </button>
            </div>

            {history.length === 0 ? (
              <div className="empty-state">
                {loadingHistory
                  ? "Loading email history..."
                  : "No email history records found."}
              </div>
            ) : (
              <div className="history-table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Subject</th>
                      <th>Recipients</th>
                      <th>Sent</th>
                      <th>Failed</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.map((record, index) => {
                      const sent = Number(
                        record.sentTo?.length ??
                          record.successfulRecipients?.length ??
                          record.sent ??
                          0
                      );

                      const failed = Number(
                        record.failedTo?.length ??
                          record.failedRecipients?.length ??
                          record.failed ??
                          0
                      );

                      const recipientCount = Number(
                        record.recipients?.length ??
                          record.totalRecipients ??
                          sent + failed
                      );

                      const recordStatus = getRecordStatus(record);

                      return (
                        <tr
                          key={record._id || `${record.subject}-${index}`}
                        >
                          <td>{formatDate(record.createdAt)}</td>

                          <td>
                            <div
                              className="history-subject"
                              title={record.subject || ""}
                            >
                              {record.subject || "(No subject)"}
                            </div>
                          </td>

                          <td>{recipientCount}</td>
                          <td>{sent}</td>
                          <td>{failed}</td>

                          <td>
                            <span
                              className={`status-badge badge-${recordStatus}`}
                            >
                              {recordStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <p>
          <strong>BulkMail</strong> — Bulk email management dashboard
        </p>
      </footer>
    </div>
  );
}

export default App;