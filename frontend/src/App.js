import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import "./App.css";

const API_URL = (
  process.env.REACT_APP_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const MAX_RECIPIENTS = 10;

function extractEmails(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,;]+/);

  return parts
    .map((item) => String(item || "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function uniqueEmails(emails) {
  return [...new Map(
    emails.map((email) => [email.toLowerCase(), email])
  ).values()];
}

function formatDate(value) {
  if (!value) return "Just now";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getStatusText(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "sent" || normalized === "success") return "Sent";
  if (normalized === "partial") return "Partially sent";
  if (normalized === "failed" || normalized === "error") return "Failed";
  if (normalized === "pending") return "Pending";

  return status || "Unknown";
}

function App() {
  const [recipientsText, setRecipientsText] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [sending, setSending] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [activeView, setActiveView] = useState("compose");
  const [searchTerm, setSearchTerm] = useState("");
  const fileInputRef = useRef(null);

  const enteredEmails = useMemo(
    () => extractEmails(recipientsText),
    [recipientsText]
  );

  const recipients = useMemo(
    () => uniqueEmails(enteredEmails),
    [enteredEmails]
  );

  const invalidEmails = useMemo(
    () => recipients.filter((email) => !isValidEmail(email)),
    [recipients]
  );

  const validEmails = useMemo(
    () => recipients.filter(isValidEmail),
    [recipients]
  );

  const duplicateCount = enteredEmails.length - recipients.length;

  const showNotice = useCallback((type, text) => {
    setNotice({ type, text });
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const response = await axios.get(`${API_URL}/history`);
      const data = response.data;

      const records = Array.isArray(data)
        ? data
        : data?.history || data?.emails || data?.records || [];

      setHistory(Array.isArray(records) ? records : []);
    } catch (error) {
      console.error("Unable to load email history:", error);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const extension = file.name.split(".").pop().toLowerCase();

    if (!["xlsx", "xls", "csv"].includes(extension)) {
      showNotice("error", "Please upload an Excel (.xlsx, .xls) or CSV file.");
      event.target.value = "";
      return;
    }

    setReadingFile(true);
    setSelectedFile(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error("The selected file does not contain a worksheet.");
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const extracted = [];

      rows.forEach((row, rowIndex) => {
        if (!Array.isArray(row)) return;

        // Read email addresses from the first column.
        // A heading such as "Email" or "Email Address" is ignored.
        const cell = String(row[0] || "").trim();
        if (!cell) return;

        if (
          rowIndex === 0 &&
          /^(e-?mail|email address|recipient|recipients)$/i.test(cell)
        ) {
          return;
        }

        extracted.push(...extractEmails(cell));
      });

      const mergedEmails = uniqueEmails([
        ...enteredEmails,
        ...extracted,
      ]);

      if (mergedEmails.length === 0) {
        showNotice(
          "error",
          "No email addresses were found in the first column of this file."
        );
        return;
      }

      const limitedEmails = mergedEmails.slice(0, MAX_RECIPIENTS);
      setRecipientsText(limitedEmails.join("\n"));

      const validCount = limitedEmails.filter(isValidEmail).length;
      const invalidCount = limitedEmails.length - validCount;

      let result = `${limitedEmails.length} unique recipient(s) loaded.`;

      if (mergedEmails.length > MAX_RECIPIENTS) {
        result += ` The first ${MAX_RECIPIENTS} were kept because of the recipient limit.`;
      }

      if (invalidCount > 0) {
        result += ` ${invalidCount} address(es) need correction.`;
      } else if (validCount > 0) {
        result += " Ready to review.";
      }

      showNotice("success", result);
    } catch (error) {
      console.error("File reading error:", error);
      showNotice(
        "error",
        error.message || "Unable to read this file. Please check its format."
      );
    } finally {
      setReadingFile(false);
      event.target.value = "";
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();

    if (sending) return;

    if (recipients.length === 0) {
      showNotice("error", "Add at least one recipient email address.");
      return;
    }

    if (recipients.length > MAX_RECIPIENTS) {
      showNotice(
        "error",
        `You can send to a maximum of ${MAX_RECIPIENTS} recipients at a time.`
      );
      return;
    }

    if (invalidEmails.length > 0) {
      showNotice(
        "error",
        `Please correct these email addresses: ${invalidEmails.join(", ")}`
      );
      return;
    }

    if (!subject.trim()) {
      showNotice("error", "Please enter an email subject.");
      return;
    }

    if (!message.trim()) {
      showNotice("error", "Please enter your email message.");
      return;
    }

    setSending(true);
    showNotice("loading", "Sending your emails...");

    try {
      const response = await axios.post(`${API_URL}/sendmail`, {
        subject: subject.trim(),
        body: message.trim(),
        recipients,
      });

      const data = response.data || {};
      const successCount = Number(
        data.successfulRecipients?.length ??
        data.successful ??
        data.sent ??
        data.sentCount ??
        0
      );

      const failedCount = Number(
        data.failedRecipients?.length ??
        data.failed ??
        data.failedCount ??
        0
      );

      const serverMessage = String(data.message || "");

      if (
        failedCount > 0 ||
        String(data.status || "").toLowerCase() === "failed" ||
        String(data.status || "").toLowerCase() === "partial"
      ) {
        showNotice(
          "error",
          serverMessage ||
            `Sending finished. Sent: ${successCount}; failed: ${failedCount}.`
        );
      } else {
        showNotice(
          "success",
          serverMessage ||
            `Emails submitted successfully. Sent: ${successCount}; failed: ${failedCount}.`
        );
      }

      setSubject("");
      setMessage("");
      await loadHistory();
      setActiveView("compose");
    } catch (error) {
      console.error("Email sending error:", error);

      const serverMessage =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Unable to send emails.";

      showNotice("error", serverMessage);
    } finally {
      setSending(false);
    }
  };

  const filteredHistory = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return history;

    return history.filter((item) => {
      const recipientsValue = Array.isArray(item.recipients)
        ? item.recipients.join(" ")
        : String(item.recipients || "");

      return [
        item.subject,
        item.body,
        item.status,
        recipientsValue,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [history, searchTerm]);

  const totalRecipientsSent = history.reduce((total, item) => {
    const successful = Array.isArray(item.successfulRecipients)
      ? item.successfulRecipients.length
      : Number(item.successful || item.sent || 0);

    return total + successful;
  }, 0);

  const successfulCampaigns = history.filter(
    (item) => String(item.status || "").toLowerCase() === "sent"
  ).length;

  const handleClearForm = () => {
    setRecipientsText("");
    setSubject("");
    setMessage("");
    setSelectedFile("");
    setNotice(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" onClick={() => setActiveView("compose")}>
          <span className="brand-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6.5 12 13l9-6.5" />
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="m4 18 6-5m10 5-6-5" />
            </svg>
          </span>
          <span className="brand-name">Bulk<span>Mail</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <button
            className={`nav-item ${activeView === "compose" ? "active" : ""}`}
            onClick={() => setActiveView("compose")}
            type="button"
          >
            <span className="nav-icon">✉</span>
            <span>Compose email</span>
          </button>

          <button
            className={`nav-item ${activeView === "history" ? "active" : ""}`}
            onClick={() => {
              setActiveView("history");
              loadHistory();
            }}
            type="button"
          >
            <span className="nav-icon">◷</span>
            <span>Email history</span>
            <span className="nav-count">{history.length}</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">✦</div>
            <strong>Bulk emailing, simplified.</strong>
            <p>Import your contacts, write your message, and send.</p>
          </div>

          <div className="connection-status">
            <span className="status-dot" />
            <span>Local workspace</span>
          </div>
          <div className="sidebar-version">BULKMAIL WORKSPACE</div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <div className="breadcrumb">Workspace <span>/</span> {activeView === "history" ? "Email history" : "Compose"}</div>
            <h1>{activeView === "history" ? "Email history" : "Email campaign"}</h1>
          </div>

          <div className="topbar-right">
            <span className="backend-indicator">
              <span className="status-dot" />
              Backend connected
            </span>
            <div className="avatar" aria-label="BulkMail account">B</div>
          </div>
        </header>

        {notice && (
          <div
            className={`notice notice-${notice.type}`}
            role={notice.type === "error" ? "alert" : "status"}
          >
            <span className="notice-symbol">
              {notice.type === "loading"
                ? "◌"
                : notice.type === "error"
                ? "!"
                : "✓"}
            </span>
            <span>{notice.text}</span>
            <button
              className="notice-close"
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}

        <section className="stats-grid" aria-label="Email statistics">
          <article className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Campaigns</span>
              <span className="stat-icon purple">✉</span>
            </div>
            <div className="stat-value">{history.length}</div>
            <div className="stat-foot">Total email records</div>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Successful campaigns</span>
              <span className="stat-icon green">✓</span>
            </div>
            <div className="stat-value">{successfulCampaigns}</div>
            <div className="stat-foot">Marked as sent</div>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Recipients sent</span>
              <span className="stat-icon blue">↗</span>
            </div>
            <div className="stat-value">{totalRecipientsSent}</div>
            <div className="stat-foot">Based on recorded history</div>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Current recipients</span>
              <span className="stat-icon orange">◎</span>
            </div>
            <div className="stat-value">{recipients.length}<span className="stat-limit"> / {MAX_RECIPIENTS}</span></div>
            <div className="stat-foot">Per sending request</div>
          </article>
        </section>

        {activeView === "compose" ? (
          <div className="content-grid">
            <section className="panel compose-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">NEW CAMPAIGN</div>
                  <h2>Compose your email</h2>
                  <p>Create your message and choose your recipients.</p>
                </div>
                <div className="heading-icon">✎</div>
              </div>

              <form onSubmit={handleSend} noValidate>
                <div className="field-group">
                  <div className="field-label-row">
                    <label htmlFor="recipients">Recipients</label>
                    <span className="field-hint">Up to {MAX_RECIPIENTS} addresses</span>
                  </div>

                  <div className="recipient-box">
                    <div className="recipient-box-top">
                      <span className="recipient-caption">TO</span>
                      <span className={`recipient-count ${recipients.length >= MAX_RECIPIENTS ? "limit-reached" : ""}`}>
                        {recipients.length} / {MAX_RECIPIENTS}
                      </span>
                    </div>
                    <textarea
                      id="recipients"
                      value={recipientsText}
                      onChange={(event) => setRecipientsText(event.target.value)}
                      placeholder={"Enter email addresses separated by commas or new lines\nexample@email.com"}
                      rows={4}
                      aria-describedby="recipient-help"
                    />
                    <div className="recipient-box-footer">
                      <span id="recipient-help">
                        {duplicateCount > 0
                          ? `${duplicateCount} duplicate address(es) will be removed.`
                          : "Paste addresses or import a contact list."}
                      </span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={readingFile}
                      >
                        {readingFile ? "Reading..." : "+ Import file"}
                      </button>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    className="visually-hidden"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                  />

                  {selectedFile && (
                    <div className="file-chip">
                      <span className="file-chip-icon">▤</span>
                      <span className="file-chip-name">{selectedFile}</span>
                      <span className="file-chip-detail">{recipients.length} unique address(es)</span>
                      <button
                        type="button"
                        aria-label="Remove imported file name"
                        onClick={() => setSelectedFile("")}
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {invalidEmails.length > 0 && (
                    <div className="inline-warning">
                      {invalidEmails.length} invalid address(es) need correction before sending.
                    </div>
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="subject">Email subject</label>
                  <input
                    id="subject"
                    type="text"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="e.g. An update from our team"
                    maxLength={200}
                  />
                  <div className="character-count">{subject.length}/200</div>
                </div>

                <div className="field-group">
                  <div className="field-label-row">
                    <label htmlFor="message">Message</label>
                    <span className="field-hint">Plain text email</span>
                  </div>
                  <textarea
                    id="message"
                    className="message-textarea"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={"Hi there,\n\nWrite your email message here...\n\nBest regards"}
                    rows={8}
                  />
                  <div className="character-count">{message.length} characters</div>
                </div>

                <div className="form-footer">
                  <div className="secure-note">
                    <span>▣</span> Sent through your configured email account
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleClearForm}
                      disabled={sending}
                    >
                      Clear form
                    </button>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={sending || readingFile}
                    >
                      {sending ? (
                        <>
                          <span className="button-spinner" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <span>➤</span>
                          Send emails
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </section>

            <aside className="right-column">
              <section className="panel import-panel">
                <div className="side-panel-title">
                  <span className="side-title-icon">⇧</span>
                  <div>
                    <h3>Import contacts</h3>
                    <p>Upload your recipient list</p>
                  </div>
                </div>

                <button
                  type="button"
                  className="upload-zone"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={readingFile}
                >
                  <span className="upload-icon">↑</span>
                  <strong>{readingFile ? "Reading your file..." : "Choose a file to upload"}</strong>
                  <span>Excel or CSV · First column</span>
                  <span className="upload-browse">Browse files</span>
                </button>

                <div className="supported-files">
                  <span className="file-type-badge">XLSX</span>
                  <span className="file-type-badge">XLS</span>
                  <span className="file-type-badge">CSV</span>
                  <span>Max {MAX_RECIPIENTS} unique recipients per send</span>
                </div>

                <div className="tip-box">
                  <span className="tip-star">✦</span>
                  <div>
                    <strong>Quick tip</strong>
                    <p>Keep email addresses in the first column of your spreadsheet. A heading such as “Email” is supported.</p>
                  </div>
                </div>
              </section>

              <section className="panel recent-panel">
                <div className="recent-heading">
                  <div>
                    <h3>Recent activity</h3>
                    <p>Your latest email records</p>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setActiveView("history");
                      loadHistory();
                    }}
                  >
                    View all
                  </button>
                </div>

                {historyLoading ? (
                  <div className="empty-state small-empty">
                    <span className="loading-ring" />
                    <p>Loading history...</p>
                  </div>
                ) : history.length === 0 ? (
                  <div className="empty-state small-empty">
                    <span className="empty-icon">◷</span>
                    <strong>No activity yet</strong>
                    <p>Your email records will appear here.</p>
                  </div>
                ) : (
                  <div className="recent-list">
                    {history.slice(0, 4).map((item, index) => (
                      <div className="recent-item" key={item._id || item.id || `${item.subject}-${index}`}>
                        <span className="recent-item-icon">✉</span>
                        <div className="recent-item-main">
                          <strong>{item.subject || "Untitled email"}</strong>
                          <span>{formatDate(item.createdAt || item.date)}</span>
                        </div>
                        <span className={`status-pill status-${String(item.status || "pending").toLowerCase()}`}>
                          {getStatusText(item.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </div>
        ) : (
          <section className="panel history-panel">
            <div className="history-heading">
              <div>
                <div className="eyebrow">CAMPAIGN RECORDS</div>
                <h2>All email activity</h2>
                <p>Review your recorded sending attempts.</p>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={loadHistory}
                disabled={historyLoading}
              >
                ↻ Refresh
              </button>
            </div>

            <div className="history-search">
              <span>⌕</span>
              <input
                type="search"
                placeholder="Search subject, recipient, or status..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            {historyLoading ? (
              <div className="empty-state">
                <span className="loading-ring" />
                <strong>Loading email history</strong>
                <p>Please wait while your records load.</p>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">◷</span>
                <strong>{searchTerm ? "No matching records" : "No email history yet"}</strong>
                <p>{searchTerm ? "Try a different search term." : "After sending emails, your records will appear here."}</p>
                {searchTerm && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSearchTerm("")}
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="table-scroll">
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
                    {filteredHistory.map((item, index) => {
                      const recipientList = Array.isArray(item.recipients)
                        ? item.recipients
                        : item.recipients
                        ? [item.recipients]
                        : [];

                      return (
                        <tr key={item._id || item.id || `${item.subject}-${index}`}>
                          <td>
                            <div className="table-subject">{item.subject || "Untitled email"}</div>
                            <div className="table-subtitle">
                              {item.body
                                ? `${String(item.body).slice(0, 70)}${String(item.body).length > 70 ? "…" : ""}`
                                : "No message preview"}
                            </div>
                          </td>
                          <td>
                            <div className="recipient-cell">
                              <span className="recipient-mini-icon">✉</span>
                              <span>
                                {recipientList.length
                                  ? `${recipientList.length} recipient(s)`
                                  : "Not recorded"}
                              </span>
                            </div>
                            {recipientList.length > 0 && (
                              <div className="table-subtitle recipient-preview">
                                {recipientList.slice(0, 2).join(", ")}
                                {recipientList.length > 2 ? "…" : ""}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`status-pill status-${String(item.status || "pending").toLowerCase()}`}>
                              {getStatusText(item.status)}
                            </span>
                          </td>
                          <td className="date-cell">
                            {formatDate(item.createdAt || item.date)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <footer className="app-footer">
          <span>© {new Date().getFullYear()} BulkMail</span>
          <span><span className="status-dot" /> Your email workspace</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
