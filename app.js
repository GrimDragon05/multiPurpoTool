// ---------------------------------------------------------------------
// Small API client. Every call hits the Worker's /api/* routes, which
// read/write Cloudflare D1 — so any device that logs in sees the same
// live data. Nothing here is stored only "locally" except the login
// token itself.
//
// This page is hosted on GitHub Pages, so it's a different origin from
// the Worker — every request below is cross-origin, hence the full URL
// and the Worker's CORS headers.
// ---------------------------------------------------------------------

// EDIT THIS before publishing to GitHub Pages: your deployed Worker URL,
// no trailing slash, e.g. "https://attendance-app.yourname.workers.dev"
const API_BASE = "https://attendance-app.YOUR-SUBDOMAIN.workers.dev";

const state = { token: localStorage.getItem("rb_token") || null, username: localStorage.getItem("rb_username") || null, role: localStorage.getItem("rb_role") || null, students: [] };

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
function setSession(token, username, role) {
  state.token = token; state.username = username; state.role = role;
  localStorage.setItem("rb_token", token);
  localStorage.setItem("rb_username", username);
  localStorage.setItem("rb_role", role);
}

function clearSession() {
  state.token = state.username = state.role = null;
  localStorage.removeItem("rb_token"); localStorage.removeItem("rb_username"); localStorage.removeItem("rb_role");
}

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-screen").hidden = false;
  document.getElementById("who-username").textContent = state.username;
  document.getElementById("who-role").textContent = state.role;
  loadStudents().then(() => { renderAttendanceTable(); renderPaymentStudentOptions(); });
}

function showLogin() {
  document.getElementById("login-screen").hidden = false;
  document.getElementById("app-screen").hidden = true;
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.hidden = true;
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setSession(data.token, data.username, data.role);
    showApp();
  } catch (err) {
    errEl.textContent = err.message; errEl.hidden = false;
  }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const errEl = document.getElementById("register-error");
  errEl.hidden = true;
  try {
    await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setSession(data.token, data.username, data.role);
    showApp();
  } catch (err) {
    errEl.textContent = err.message; errEl.hidden = false;
  }
});

document.getElementById("show-register").addEventListener("click", () => {
  document.querySelector(".login-card:not(#register-card)").hidden = true;
  document.getElementById("register-card").hidden = false;
});
document.getElementById("show-login").addEventListener("click", () => {
  document.querySelector(".login-card:not(#register-card)").hidden = false;
  document.getElementById("register-card").hidden = true;
});
document.getElementById("logout-btn").addEventListener("click", () => { clearSession(); showLogin(); });

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  const tab = btn.dataset.tab;
  ["attendance", "students", "payments"].forEach((t) => {
    document.getElementById(`panel-${t}`).hidden = t !== tab;
  });
  if (tab === "payments") loadPayments();
});

// ---------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------
async function loadStudents() {
  state.students = await api("/api/students");
  renderStudentsTable();
}

function renderStudentsTable() {
  const tbody = document.getElementById("students-rows");
  tbody.innerHTML = "";
  for (const s of state.students) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(s.student_code || "—")}</td>
      <td>${escapeHtml(s.class_name || "—")}</td>
      <td>${escapeHtml(s.contact || "—")}</td>
      <td class="row-actions">
        <button data-edit="${s.id}">Edit</button>
        <button data-del="${s.id}" class="danger">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  }
}

document.getElementById("students-rows").addEventListener("click", (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) openStudentDialog(state.students.find((s) => String(s.id) === editId));
  if (delId) deleteStudent(delId);
});

function openStudentDialog(student) {
  document.getElementById("student-dialog-title").textContent = student ? "Edit student" : "Add student";
  document.getElementById("student-id").value = student ? student.id : "";
  document.getElementById("student-name").value = student ? student.full_name : "";
  document.getElementById("student-code").value = student ? student.student_code || "" : "";
  document.getElementById("student-class").value = student ? student.class_name || "" : "";
  document.getElementById("student-contact").value = student ? student.contact || "" : "";
  document.getElementById("student-dialog").showModal();
}

document.getElementById("new-student-btn").addEventListener("click", () => openStudentDialog(null));
document.getElementById("student-cancel").addEventListener("click", () => document.getElementById("student-dialog").close());

document.getElementById("student-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("student-id").value;
  const payload = {
    full_name: document.getElementById("student-name").value.trim(),
    student_code: document.getElementById("student-code").value.trim(),
    class_name: document.getElementById("student-class").value.trim(),
    contact: document.getElementById("student-contact").value.trim(),
  };
  if (id) await api(`/api/students/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  else await api("/api/students", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("student-dialog").close();
  await loadStudents();
  renderAttendanceTable();
  renderPaymentStudentOptions();
});

async function deleteStudent(id) {
  if (!confirm("Remove this student? Their attendance and payment history will be removed too.")) return;
  await api(`/api/students/${id}`, { method: "DELETE" });
  await loadStudents();
  renderAttendanceTable();
  renderPaymentStudentOptions();
}

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------
const dateInput = document.getElementById("attendance-date");
dateInput.valueAsDate = new Date();
dateInput.addEventListener("change", renderAttendanceTable);

async function renderAttendanceTable() {
  const tbody = document.getElementById("attendance-rows");
  const emptyState = document.getElementById("attendance-empty");
  tbody.innerHTML = "";
  emptyState.hidden = state.students.length > 0;
  if (!state.students.length) return;

  const date = dateInput.value;
  let existing = [];
  try { existing = await api(`/api/attendance?date=${date}`); } catch { existing = []; }
  const byStudent = Object.fromEntries(existing.map((r) => [r.student_id, r.status]));

  for (const s of state.students) {
    const current = byStudent[s.id] || "";
    const tr = document.createElement("tr");
    tr.dataset.studentId = s.id;
    tr.innerHTML = `
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(s.class_name || "—")}</td>
      ${["present", "late", "absent", "excused"].map((status) => `
        <td class="status-col">
          <input type="radio" name="status-${s.id}" value="${status}" ${current === status ? "checked" : ""} />
        </td>`).join("")}
    `;
    tbody.appendChild(tr);
  }
}

document.getElementById("save-attendance").addEventListener("click", async () => {
  const date = dateInput.value;
  const rows = [];
  for (const s of state.students) {
    const checked = document.querySelector(`input[name="status-${s.id}"]:checked`);
    if (checked) rows.push({ student_id: s.id, date, status: checked.value });
  }
  if (!rows.length) return alert("Mark at least one student first.");
  await api("/api/attendance", { method: "POST", body: JSON.stringify(rows) });
  alert(`Saved attendance for ${rows.length} student(s) on ${date}.`);
});

// ---------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------
function renderPaymentStudentOptions() {
  const select = document.getElementById("payment-student");
  select.innerHTML = state.students.map((s) => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join("");
}

async function loadPayments() {
  const status = document.getElementById("payment-filter").value;
  const rows = await api(`/api/payments${status ? `?status=${status}` : ""}`);
  const tbody = document.getElementById("payments-rows");
  tbody.innerHTML = rows.map((p) => `
    <tr>
      <td>${escapeHtml(p.full_name)}</td>
      <td>${escapeHtml(p.period || "—")}</td>
      <td class="amount">${p.currency} ${Number(p.amount).toFixed(2)}</td>
      <td><span class="badge ${p.status}">${p.status}</span></td>
      <td>${escapeHtml(p.paid_on || "—")}</td>
      <td>${escapeHtml(p.notes || "—")}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty-state">No payment records yet.</td></tr>`;
}

document.getElementById("payment-filter").addEventListener("change", loadPayments);
document.getElementById("new-payment-btn").addEventListener("click", () => {
  document.getElementById("payment-form").reset();
  document.getElementById("payment-dialog").showModal();
});
document.getElementById("payment-cancel").addEventListener("click", () => document.getElementById("payment-dialog").close());

document.getElementById("payment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    student_id: document.getElementById("payment-student").value,
    amount: parseFloat(document.getElementById("payment-amount").value),
    period: document.getElementById("payment-period").value.trim(),
    status: document.getElementById("payment-status").value,
    paid_on: document.getElementById("payment-paid-on").value,
    notes: document.getElementById("payment-notes").value.trim(),
  };
  await api("/api/payments", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("payment-dialog").close();
  loadPayments();
});

// ---------------------------------------------------------------------
// Utilities & boot
// ---------------------------------------------------------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

if (state.token) showApp(); else showLogin();
