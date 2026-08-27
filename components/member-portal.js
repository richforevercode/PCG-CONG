(function () {
  "use strict";

  const config = window.PCG_SUPABASE || {};
  const publicKey = config.anonKey || config.key;
  const client = config.url && publicKey && window.supabase ? window.supabase.createClient(config.url, publicKey) : null;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const relation = (record, key) => Array.isArray(record?.[key]) ? record[key][0] : record?.[key];
  const num = value => Number(value || 0);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const dateFromIso = value => new Date(`${value}T00:00:00`);
  const dateFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" });
  const longDateFormat = new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "long", year: "numeric" });
  const monthFormat = new Intl.DateTimeFormat("en-GH", { month: "long", year: "numeric" });
  const money = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 });
  const pageNames = { dashboard: "Dashboard", profile: "My Profile", giving: "My Giving", pledges: "My Pledges", communion: "My Communion", attendance: "My Attendance", events: "Events & Calendar", announcements: "Announcements", fellowship: "My Fellowship", settings: "Settings" };
  const state = { user: null, profile: null, member: null, role: null, giving: [], communion: [], attendance: [], events: [], announcements: [], groups: [], rsvps: [], requests: [], preferences: null, page: "dashboard", givingCategory: "all", givingFrom: "", givingTo: "" };

  function icons() { window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } }); }
  function formatDate(value, long = false) { return value ? (long ? longDateFormat : dateFormat).format(dateFromIso(value)) : "Not recorded"; }
  function fullName(member = state.member) { return `${member?.first_name || ""} ${member?.last_name || ""}`.trim() || state.profile?.display_name || "Member"; }
  function initials(value = fullName()) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "M"; }
  function roleOf(profile) { return Array.isArray(profile?.app_roles) ? profile.app_roles[0] : profile?.app_roles; }
  function eventOf(record) { return relation(record, "events"); }
  function occasionOf(record) { return relation(record, "communion_occasions"); }
  function eventTime(value) { if (!value) return "Time to be announced"; const [hour, minute] = value.split(":").map(Number); return new Date(2026, 0, 1, hour, minute).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }); }
  function truncate(value, size = 150) { const text = String(value || ""); return text.length > size ? `${text.slice(0, size).trim()}…` : text; }
  function toast(message, type = "success") { const node = document.createElement("div"); node.className = `member-toast ${type}`; node.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i><span>${esc(message)}</span>`; $("#memberToastRegion").append(node); icons(); setTimeout(() => node.remove(), 3600); }
  function formError(selector, message = "") { const node = $(selector); if (!node) return; node.hidden = !message; node.textContent = message; }
  function pageHeading(eyebrow, title, description) { return `<div class="member-page-heading"><div><p>${esc(eyebrow)}</p><h1>${esc(title)}</h1></div><span>${esc(description)}</span></div>`; }
  function empty(icon, title, message) { return `<div class="member-empty"><i data-lucide="${icon}"></i><strong>${esc(title)}</strong><span>${esc(message)}</span></div>`; }
  function badge(label, tone = "neutral") { return `<span class="member-badge ${tone}">${esc(label)}</span>`; }
  function summaryCard(label, value, note, icon, tone = "#0a3995") { return `<article class="member-summary-card" style="--tone:${tone}"><span>${esc(label)}<i data-lucide="${icon}"></i></span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`; }
  function avatarMarkup(className = "member-profile-avatar") { return `<span class="${className}">${state.member?.profile_photo_url ? `<img src="${esc(state.member.profile_photo_url)}" alt="${esc(fullName())}" />` : esc(initials())}</span>`; }

  function classification() {
    if (!state.member?.date_of_birth) return { name: "Not classified", description: "A date of birth is required for automatic classification." };
    const ageDate = dateFromIso(state.member.date_of_birth); const today = new Date(); let age = today.getFullYear() - ageDate.getFullYear();
    if (today.getMonth() < ageDate.getMonth() || (today.getMonth() === ageDate.getMonth() && today.getDate() < ageDate.getDate())) age -= 1;
    const group = state.groups.filter(item => item.status === "Active" && age >= item.minimum_age && (item.maximum_age === null || age <= item.maximum_age) && (item.gender === "All" || item.gender === state.member.gender)).sort((a, b) => b.minimum_age - a.minimum_age)[0];
    return { name: group?.name || "Not classified", description: group?.description || "No active generational-group rule matches this member.", age };
  }

  function accountedGiving() { return state.giving.filter(item => !["Pending", "Voided"].includes(item.status)); }
  function filteredGiving() { return accountedGiving().filter(item => state.givingCategory === "all" || item.collection_type === state.givingCategory).filter(item => !state.givingFrom || item.collection_date >= state.givingFrom).filter(item => !state.givingTo || item.collection_date <= state.givingTo); }
  function pledgeRecords() { return accountedGiving().filter(item => ["Day Born Mini-Harvest", "Main Harvest"].includes(item.collection_type) && num(item.pledge_amount) > 0); }
  function upcomingEvents() { return state.events.filter(item => item.event_date >= todayIso() && item.status !== "Cancelled").sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time || "").localeCompare(b.start_time || "")); }
  function recentCommunion() { return state.communion.filter(item => item.partook).sort((a, b) => (occasionOf(b)?.communion_date || "").localeCompare(occasionOf(a)?.communion_date || "")); }

  function eventListMarkup(records) {
    return records.length ? `<div class="member-list">${records.map(event => `<div class="member-list-item"><span class="member-list-icon"><i data-lucide="calendar-days"></i></span><span><strong>${esc(event.title)}</strong><small>${esc(event.location)} · ${esc(event.type)}</small></span><time>${formatDate(event.event_date)}<br>${esc(eventTime(event.start_time))}</time></div>`).join("")}</div>` : empty("calendar-x-2", "No upcoming events", "New church events intended for you will appear here.");
  }

  function announcementListMarkup(records) {
    return records.length ? `<div class="member-list">${records.map(item => `<div class="member-list-item"><span class="member-list-icon"><i data-lucide="megaphone"></i></span><span><strong>${esc(item.title)}</strong><small>${esc(truncate(item.content, 90))}</small></span>${badge(item.priority, item.priority === "Urgent" ? "urgent" : item.priority === "Important" ? "warning" : "neutral")}</div>`).join("")}</div>` : empty("inbox", "No announcements", "There are no published announcements intended for you.");
  }

  function dashboardMarkup() {
    const group = classification(); const year = todayIso().slice(0, 4); const giving = accountedGiving().filter(item => item.collection_date.startsWith(year));
    const givingTotal = giving.reduce((sum, item) => sum + num(item.amount), 0); const outstanding = pledgeRecords().reduce((sum, item) => sum + num(item.outstanding_pledge), 0); const communion = recentCommunion()[0]; const lastAttendance = state.attendance.slice().sort((a, b) => b.attendance_date.localeCompare(a.attendance_date))[0]; const events = upcomingEvents();
    return `<section class="member-welcome"><div><p>WELCOME TO YOUR MEMBER PORTAL</p><h1>Hello, ${esc(state.member.first_name || fullName())}</h1><span>${esc(state.member.group_name || group.name)} · ${esc(state.member.status)} member</span></div>${avatarMarkup()}</section><div class="member-summary-grid">${summaryCard("Giving this year", money.format(givingTotal), `${giving.length} recorded contribution${giving.length === 1 ? "" : "s"}`, "hand-coins", "#087a38")}${summaryCard("Pledge balance", money.format(outstanding), outstanding ? "Outstanding pledges" : "No outstanding balance", "badge-dollar-sign", "#b54708")}${summaryCard("Recent Communion", communion ? formatDate(occasionOf(communion)?.communion_date) : "None yet", communion ? occasionOf(communion)?.service_name : "No recorded participation", "church", "#0a3995")}${summaryCard("Recent attendance", lastAttendance ? formatDate(lastAttendance.attendance_date) : "None yet", lastAttendance ? `${lastAttendance.status} · ${eventOf(lastAttendance)?.title || "Service"}` : "Only actual personal records appear", "calendar-check-2", "#d80011")}${summaryCard("Upcoming events", String(events.length), "Events intended for you", "calendar-days", "#2057b7")}</div><div class="member-two-column"><article class="member-card"><div class="member-card-heading"><div><p>COMING UP</p><h2>Upcoming events</h2><span>Services, programmes, and fellowship activities intended for you.</span></div><button class="member-button ghost" type="button" data-member-page="events">View calendar</button></div>${eventListMarkup(events.slice(0, 5))}</article><article class="member-card"><div class="member-card-heading"><div><p>SHORTCUTS</p><h2>Quick actions</h2></div></div><div class="member-quick-grid">${[["profile","circle-user-round","My Profile"],["giving","hand-coins","My Giving"],["pledges","badge-dollar-sign","My Pledges"],["communion","church","My Communion"],["events","calendar-days","View Events"]].map(([page, icon, label]) => `<button type="button" data-member-page="${page}"><i data-lucide="${icon}"></i>${label}</button>`).join("")}</div></article></div><article class="member-card"><div class="member-card-heading"><div><p>CHURCH NEWS</p><h2>Recent announcements</h2></div><button class="member-button ghost" type="button" data-member-page="announcements">View all</button></div>${announcementListMarkup(state.announcements.slice(0, 4))}</article>`;
  }

  function profileMarkup() {
    const group = classification(); const requests = state.requests.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    const detail = (label, value) => `<div class="member-detail"><span>${esc(label)}</span><strong>${esc(value || "Not recorded")}</strong></div>`;
    return `${pageHeading("PERSONAL RECORD", "My Profile", "View your official church identity and update approved contact information.")}<article class="member-card"><div class="member-profile-hero">${avatarMarkup()}<div><h2>${esc(fullName())}</h2><p>${esc(state.member.membership_number || "Membership number not assigned")} · ${esc(group.name)}</p><span class="member-status">${esc(state.member.status)}</span></div></div><div class="member-detail-grid">${detail("Membership number", state.member.membership_number)}${detail("Date of birth", formatDate(state.member.date_of_birth, true))}${detail("Current age", group.age === undefined ? "Not available" : `${group.age} years`)}${detail("Gender", state.member.gender)}${detail("Communicant status", state.member.communicant_status)}${detail("Date joined", formatDate(state.member.joined_at, true))}${detail("Phone number", state.member.phone)}${detail("Email address", state.member.email)}${detail("Address / location", state.member.address)}${detail("Fellowship / department", state.member.group_name)}${detail("Generational group", group.name)}${detail("Church role", state.member.role)}${detail("Emergency contact", state.member.emergency_contact_name)}${detail("Emergency phone", state.member.emergency_contact_phone)}${detail("Account email", state.profile.email)}</div><div class="member-profile-actions"><button class="member-button primary" type="button" data-member-contact><i data-lucide="pencil"></i> Update contact information</button><button class="member-button secondary" type="button" data-member-request><i data-lucide="message-square-text"></i> Request official correction</button></div></article><article class="member-card" style="margin-top:18px"><div class="member-card-heading"><div><p>UPDATE REQUESTS</p><h2>Protected profile changes</h2><span>Official fields are changed only after church review.</span></div></div>${requests.length ? `<div class="member-list">${requests.map(item => `<div class="member-list-item"><span class="member-list-icon"><i data-lucide="file-pen-line"></i></span><span><strong>${esc(item.requested_changes?.requested_change || "Profile correction request")}</strong><small>Submitted ${formatDate(item.created_at.slice(0, 10))}${item.review_notes ? ` · ${esc(item.review_notes)}` : ""}</small></span>${badge(item.status, item.status === "Approved" ? "success" : item.status === "Declined" ? "urgent" : "warning")}</div>`).join("")}</div>` : empty("file-clock", "No update requests", "Requests for protected profile corrections will be tracked here.")}</article>`;
  }

  function givingMarkup() {
    const records = filteredGiving(); const categories = Array.from(new Set(accountedGiving().map(item => item.collection_type))).sort(); const total = records.reduce((sum, item) => sum + num(item.amount), 0); const monthKey = todayIso().slice(0, 7); const monthTotal = records.filter(item => item.collection_date.startsWith(monthKey)).reduce((sum, item) => sum + num(item.amount), 0); const yearTotal = records.filter(item => item.collection_date.startsWith(todayIso().slice(0, 4))).reduce((sum, item) => sum + num(item.amount), 0);
    return `${pageHeading("PRIVATE FINANCIAL HISTORY", "My Giving", "Only official contributions linked to your member record are shown. These records are read-only.")}<div class="member-summary-grid">${summaryCard("Filtered total", money.format(total), `${records.length} contribution${records.length === 1 ? "" : "s"}`, "hand-coins", "#087a38")}${summaryCard("This month", money.format(monthTotal), monthFormat.format(new Date()), "calendar-range", "#0a3995")}${summaryCard("This year", money.format(yearTotal), todayIso().slice(0, 4), "chart-column-big", "#b54708")}</div><div class="member-filters"><label>From<input id="memberGivingFrom" type="date" value="${esc(state.givingFrom)}" /></label><label>To<input id="memberGivingTo" type="date" value="${esc(state.givingTo)}" /></label><label>Category<select id="memberGivingCategory"><option value="all">All contribution types</option>${categories.map(category => `<option value="${esc(category)}" ${state.givingCategory === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label></div><div class="member-table-wrap"><table class="member-table"><thead><tr><th>Date</th><th>Contribution</th><th>Service / occasion</th><th>Payment method</th><th>Reference</th><th>Status</th><th>Amount</th></tr></thead><tbody>${records.length ? records.map(item => `<tr><td>${formatDate(item.collection_date)}</td><td><strong>${esc(item.collection_type)}</strong><small>${esc(item.description || (item.harvest_day ? `${item.harvest_day} group` : item.harvest_title || "Official church record"))}</small></td><td>${esc(item.service_name || item.occasion || "Unspecified service")}</td><td>${esc(item.collection_method)}</td><td>${esc(item.reference_number || "—")}</td><td>${badge(item.status, "success")}</td><td class="member-money">${money.format(num(item.amount))}</td></tr>`).join("") : `<tr><td colspan="7">${empty("hand-coins", "No giving records", "No official member-linked contributions match these filters.")}</td></tr>`}</tbody></table></div>`;
  }

  function pledgesMarkup() {
    const records = pledgeRecords(); const pledged = records.reduce((sum, item) => sum + num(item.pledge_amount), 0); const redeemed = records.reduce((sum, item) => sum + num(item.pledge_redeemed), 0); const outstanding = records.reduce((sum, item) => sum + num(item.outstanding_pledge), 0);
    return `${pageHeading("HARVEST COMMITMENTS", "My Pledges", "Pledged Amount, Pledge Redeemed, and Outstanding Balance are kept separate from ordinary giving.")}<div class="member-summary-grid">${summaryCard("Pledged Amount", money.format(pledged), "All member-linked harvest pledges", "badge-dollar-sign", "#0a3995")}${summaryCard("Pledge Redeemed", money.format(redeemed), "Official redeemed total", "circle-check-big", "#087a38")}${summaryCard("Outstanding Balance", money.format(outstanding), outstanding ? "Still to be redeemed" : "No outstanding pledge", "hourglass", "#b54708")}</div><div class="member-table-wrap" style="border-top:1px solid var(--member-line);border-radius:8px"><table class="member-table"><thead><tr><th>Date pledged</th><th>Pledge / purpose</th><th>Pledged Amount</th><th>Pledge Redeemed</th><th>Outstanding Balance</th><th>Progress</th><th>Status</th></tr></thead><tbody>${records.length ? records.map(item => { const pledge = num(item.pledge_amount); const redeemedAmount = num(item.pledge_redeemed); const balance = num(item.outstanding_pledge); const progress = pledge ? Math.min(100, redeemedAmount / pledge * 100) : 0; const status = balance <= 0 ? "Fully Redeemed" : redeemedAmount > 0 ? "Partially Redeemed" : "Active"; return `<tr><td>${formatDate(item.collection_date)}</td><td><strong>${esc(item.collection_type)}</strong><small>${esc(item.harvest_title || item.harvest_day || item.service_name || "Harvest pledge")}</small></td><td>${money.format(pledge)}</td><td class="member-money">${money.format(redeemedAmount)}</td><td>${money.format(balance)}</td><td><div class="member-progress"><div class="member-progress-track"><i style="width:${progress}%"></i></div><small>${Math.round(progress)}% redeemed</small></div></td><td>${badge(status, status === "Fully Redeemed" ? "success" : "warning")}</td></tr>`; }).join("") : `<tr><td colspan="7">${empty("badge-dollar-sign", "No personal pledges", "No harvest pledge has been linked to your member record.")}</td></tr>`}</tbody></table></div><p style="color:var(--member-muted);font-size:10px;line-height:1.5">Redemption totals are shown exactly as recorded by the finance team. The current church ledger does not itemize separate redemption transactions, so no redemption dates are fabricated here.</p>`;
  }

  function communionMarkup() {
    const records = state.communion.slice().sort((a, b) => (occasionOf(b)?.communion_date || "").localeCompare(occasionOf(a)?.communion_date || "")); const partook = records.filter(item => item.partook); const last = partook[0];
    return `${pageHeading("OFFICIAL CHURCH RECORD", "My Communion", "Your Communion history is maintained by authorized church officers and is read-only here.")}<div class="member-summary-grid">${summaryCard("Recorded participations", String(partook.length), "Explicit Partook records", "church", "#087a38")}${summaryCard("Most recent", last ? formatDate(occasionOf(last)?.communion_date) : "None yet", last ? occasionOf(last)?.service_name : "No recorded participation", "calendar-heart", "#0a3995")}</div><div class="member-table-wrap" style="border-top:1px solid var(--member-line);border-radius:8px"><table class="member-table"><thead><tr><th>Date</th><th>Service / occasion</th><th>Location</th><th>Group at occasion</th><th>Official record</th><th>Notes</th></tr></thead><tbody>${records.length ? records.map(item => { const occasion = occasionOf(item); return `<tr><td>${formatDate(occasion?.communion_date)}</td><td><strong>${esc(occasion?.service_name || "Communion service")}</strong><small>${esc(occasion?.presiding_minister || "")}</small></td><td>${esc(occasion?.location || "Not recorded")}</td><td>${esc(item.generational_group_snapshot)}</td><td>${badge(item.partook ? "Partook" : "Did not partake", item.partook ? "success" : "neutral")}</td><td>${esc(item.notes || "—")}</td></tr>`; }).join("") : `<tr><td colspan="6">${empty("church", "No Communion history", "No individual Communion participation has been recorded for you yet.")}</td></tr>`}</tbody></table></div>`;
  }

  function attendanceMarkup() {
    const records = state.attendance.slice().sort((a, b) => b.attendance_date.localeCompare(a.attendance_date)); const present = records.filter(item => item.status === "Present").length; const absent = records.filter(item => item.status === "Absent").length; const excused = records.filter(item => item.status === "Excused").length; const measured = present + absent; const consistency = measured ? Math.round(present / measured * 100) : 0; const currentMonth = todayIso().slice(0, 7); const presentThisMonth = records.filter(item => item.status === "Present" && item.attendance_date.startsWith(currentMonth)).length;
    return `${pageHeading("PERSONAL ATTENDANCE", "My Attendance", "Only actual individual attendance entries are shown. Aggregate service totals are never treated as your personal attendance.")}<div class="member-summary-grid">${summaryCard("Present", String(present), "Recorded services", "calendar-check-2", "#087a38")}${summaryCard("This month", String(presentThisMonth), `Present in ${monthFormat.format(new Date())}`, "calendar-range", "#2057b7")}${summaryCard("Absent", String(absent), "Recorded absences", "calendar-x-2", "#d80011")}${summaryCard("Excused", String(excused), "Recorded as excused", "calendar-clock", "#b54708")}${summaryCard("Consistency", measured ? `${consistency}%` : "Not enough data", "Based on Present and Absent records", "activity", "#0a3995")}</div><div class="member-table-wrap" style="border-top:1px solid var(--member-line);border-radius:8px"><table class="member-table"><thead><tr><th>Date</th><th>Service or occasion</th><th>Category</th><th>Location</th><th>Attendance record</th></tr></thead><tbody>${records.length ? records.map(item => { const event = eventOf(item); return `<tr><td>${formatDate(item.attendance_date)}</td><td><strong>${esc(event?.title || "Church service")}</strong><small>${esc(event?.description || "Official attendance record")}</small></td><td>${esc(event?.type || "Service")}</td><td>${esc(event?.location || "Not recorded")}</td><td>${badge(item.status, item.status === "Present" ? "success" : item.status === "Absent" ? "urgent" : "warning")}</td></tr>`; }).join("") : `<tr><td colspan="5">${empty("calendar-search", "No individual attendance history", "The church may currently have aggregate service totals only. Personal attendance will appear only when an individual record exists.")}</td></tr>`}</tbody></table></div>`;
  }

  function eventsMarkup() {
    const events = state.events.slice().sort((a, b) => a.event_date.localeCompare(b.event_date));
    return `${pageHeading("CHURCH CALENDAR", "Events & Calendar", "View published services and activities intended for you, and optionally share your response.")}<div class="member-event-grid">${events.length ? events.map(event => { const response = state.rsvps.find(item => item.event_id === event.id)?.response; return `<article class="member-event-card"><div class="member-event-date"><span>${formatDate(event.event_date)}</span>${badge(event.status, event.status === "Cancelled" ? "urgent" : "success")}</div><h2>${esc(event.title)}</h2><p>${esc(event.description || "Additional event information will be shared by the church.")}</p><div class="member-event-meta"><span><i data-lucide="clock-3"></i>${esc(eventTime(event.start_time))}</span><span><i data-lucide="map-pin"></i>${esc(event.location)}</span><span><i data-lucide="users-round"></i>${esc(event.audience_type === "All" ? "All members" : event.audience_group || event.audience_type)}</span></div>${event.status === "Cancelled" ? '<div class="member-rsvp"><span>This event has been cancelled.</span></div>' : `<div class="member-rsvp">${["Going", "Interested", "Unable to Attend"].map(value => `<button class="${response === value ? "active" : ""}" type="button" data-event-rsvp="${event.id}" data-response="${value}">${value}</button>`).join("")}</div>`}</article>`; }).join("") : empty("calendar-x-2", "No published events", "Events intended for you will appear here.")}</div>`;
  }

  function announcementsMarkup() {
    const records = state.announcements.slice().sort((a, b) => (b.published_at || b.created_at).localeCompare(a.published_at || a.created_at));
    return `${pageHeading("CHURCH COMMUNICATIONS", "Announcements", "Only published announcements intended for all members or your groups are visible.")}<div class="member-announcement-grid">${records.length ? records.map(item => `<article class="member-announcement-card"><div class="member-announcement-top">${badge(item.priority, item.priority === "Urgent" ? "urgent" : item.priority === "Important" ? "warning" : "neutral")}<time>${formatDate((item.published_at || item.created_at).slice(0, 10))}</time></div><h2>${esc(item.title)}</h2><p>${esc(item.content)}</p><footer><span>${esc(item.audience_type === "All" ? "All members" : item.audience_group || item.audience_type)}</span>${item.attachment_url ? `<a href="${esc(item.attachment_url)}" target="_blank" rel="noopener noreferrer">Open attachment</a>` : ""}</footer></article>`).join("") : empty("inbox", "No announcements", "There are no published announcements intended for you.")}</div>`;
  }

  function fellowshipMarkup() {
    const group = classification(); const fellowship = state.member.group_name || group.name; const relevantEvents = upcomingEvents().filter(event => event.audience_type === "All" || event.audience_group === fellowship || event.audience_group === group.name); const relevantAnnouncements = state.announcements.filter(item => item.audience_type === "All" || item.audience_group === fellowship || item.audience_group === group.name);
    return `${pageHeading("MY CHURCH COMMUNITY", "My Fellowship", "Your official fellowship and generational classification are maintained by authorized church officers.")}<article class="member-card member-fellowship-card"><span class="member-fellowship-icon"><i data-lucide="users-round"></i></span><div><h2>${esc(fellowship)}</h2><p>${esc(state.member.group_name ? "Your recorded fellowship or department." : group.description)}</p><div class="member-fellowship-tags"><span>Generational group: ${esc(group.name)}</span><span>${esc(state.member.gender)}</span><span>${esc(state.member.status)}</span></div></div></article><div class="member-two-column" style="margin-top:18px"><article class="member-card"><div class="member-card-heading"><div><p>ACTIVITIES</p><h2>Relevant upcoming events</h2></div></div>${eventListMarkup(relevantEvents.slice(0, 6))}</article><article class="member-card"><div class="member-card-heading"><div><p>UPDATES</p><h2>Fellowship announcements</h2></div></div>${announcementListMarkup(relevantAnnouncements.slice(0, 5))}</article></div>`;
  }

  function settingsMarkup() {
    const preferences = state.preferences || { email_notifications: true, event_reminders: true, communion_updates: true };
    return `${pageHeading("ACCOUNT & SECURITY", "Settings", "Manage your password and personal notification preferences securely.")}<div class="member-settings-grid"><article class="member-card"><div class="member-card-heading"><div><p>NOTIFICATIONS</p><h2>Communication preferences</h2><span>Choose the updates you would like to receive.</span></div></div><form class="member-settings-form" id="memberPreferencesForm"><label class="member-setting-toggle"><span><strong>Email notifications</strong><small>General church and account messages.</small></span><input name="email_notifications" type="checkbox" ${preferences.email_notifications ? "checked" : ""} /></label><label class="member-setting-toggle"><span><strong>Event reminders</strong><small>Reminders for relevant upcoming events.</small></span><input name="event_reminders" type="checkbox" ${preferences.event_reminders ? "checked" : ""} /></label><label class="member-setting-toggle"><span><strong>Communion updates</strong><small>Notifications related to your Communion record.</small></span><input name="communion_updates" type="checkbox" ${preferences.communion_updates ? "checked" : ""} /></label><button class="member-button primary" type="submit">Save preferences</button></form></article><article class="member-card"><div class="member-card-heading"><div><p>SECURITY</p><h2>Change password</h2><span>Your password is managed securely by the authentication provider and is never displayed.</span></div></div><form class="member-settings-form" id="memberPasswordForm"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters" /></label><label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required /></label><p class="member-form-error" id="memberPasswordError" hidden></p><button class="member-button primary" type="submit"><i data-lucide="key-round"></i> Update password</button><button class="member-button secondary" type="button" data-signout-other-sessions><i data-lucide="shield-x"></i> Sign out other sessions</button></form></article></div>`;
  }

  function render() {
    const renderers = { dashboard: dashboardMarkup, profile: profileMarkup, giving: givingMarkup, pledges: pledgesMarkup, communion: communionMarkup, attendance: attendanceMarkup, events: eventsMarkup, announcements: announcementsMarkup, fellowship: fellowshipMarkup, settings: settingsMarkup };
    const content = $("#memberPortalContent"); content.innerHTML = renderers[state.page](); content.hidden = false;
    $("#memberTopbarTitle").textContent = pageNames[state.page];
    $$('[data-member-page]').forEach(button => button.classList.toggle("active", button.dataset.memberPage === state.page));
    document.title = `${pageNames[state.page]} · Resurrection Member Portal`; icons();
  }

  function navigate(page, updateHash = true) {
    if (!pageNames[page]) page = "dashboard"; state.page = page;
    if (updateHash && location.hash !== `#${page}`) history.pushState({ page }, "", `#${page}`);
    closeMobileNavigation(); render(); $("#memberMain").focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openMobileNavigation() { $("#memberSidebar").classList.add("open"); $("#memberMobileOverlay").hidden = false; }
  function closeMobileNavigation() { $("#memberSidebar").classList.remove("open"); $("#memberMobileOverlay").hidden = true; }

  async function loadPortalData() {
    const memberId = state.profile.member_id;
    const results = await Promise.all([
      client.from("members").select("id,first_name,last_name,membership_number,date_of_birth,gender,phone,email,address,profile_photo_url,emergency_contact_name,emergency_contact_phone,group_name,role,status,joined_at,communicant_status").eq("id", memberId).single(),
      client.from("finance_collections").select("id,collection_date,collection_type,amount,collection_method,reference_number,description,occasion,service_name,status,harvest_day,harvest_title,pledge_amount,pledge_redeemed,outstanding_pledge,member_id").eq("member_id", memberId).order("collection_date", { ascending: false }),
      client.from("communion_participants").select("id,occasion_id,member_id,partook,notes,communicant_status,generational_group_snapshot,communion_occasions(id,communion_date,service_name,location,presiding_minister,notes)").eq("member_id", memberId),
      client.from("member_attendance_records").select("id,member_id,attendance_date,status,events(id,title,event_date,start_time,location,type,description,status)").eq("member_id", memberId).order("attendance_date", { ascending: false }),
      client.from("events").select("id,title,event_date,start_time,location,type,description,audience_type,audience_group,status").order("event_date", { ascending: true }),
      client.from("announcements").select("id,title,content,priority,audience_type,audience_group,attachment_url,status,published_at,created_at").order("published_at", { ascending: false }),
      client.from("generational_groups").select("id,name,minimum_age,maximum_age,gender,status,description").eq("status", "Active"),
      client.from("event_rsvps").select("id,event_id,member_id,response").eq("member_id", memberId),
      client.from("member_profile_update_requests").select("id,member_id,requested_changes,reason,status,review_notes,created_at,reviewed_at").eq("member_id", memberId),
      client.from("member_portal_preferences").select("user_id,email_notifications,event_reminders,communion_updates").eq("user_id", state.user.id).maybeSingle()
    ]);
    const failure = results.find(result => result.error);
    if (failure) throw new Error(`${failure.error.message} Confirm the Member Portal database migration has been applied.`);
    [state.member, state.giving, state.communion, state.attendance, state.events, state.announcements, state.groups, state.rsvps, state.requests, state.preferences] = [results[0].data, results[1].data || [], results[2].data || [], results[3].data || [], results[4].data || [], results[5].data || [], results[6].data || [], results[7].data || [], results[8].data || [], results[9].data || null];
  }

  function syncIdentity() {
    $("#memberAccountName").textContent = fullName();
    const avatar = $("#memberAccountAvatar"); avatar.innerHTML = state.member.profile_photo_url ? `<img src="${esc(state.member.profile_photo_url)}" alt="" />` : esc(initials());
  }

  async function initialize() {
    icons();
    if (!client) { $("#memberLoading").hidden = true; $("#memberAlert").hidden = false; $("#memberAlert").textContent = "The Supabase connection has not been configured."; return; }
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession(); if (sessionError) throw sessionError;
      state.user = sessionData.session?.user;
      if (!state.user) { location.replace("member-signin.html?reason=session"); return; }
      const { data: profile, error } = await client.from("user_profiles").select("id,email,display_name,phone,status,member_id,role_id,app_roles(id,name,permissions)").eq("id", state.user.id).single();
      if (error) throw error; state.profile = profile; state.role = roleOf(profile);
      if (profile.status !== "active") { await client.auth.signOut(); location.replace("member-signin.html?reason=inactive"); return; }
      if (state.role?.name !== "Member") { location.replace("index.html"); return; }
      if (!profile.member_id) { await client.auth.signOut(); location.replace("member-signin.html?reason=link"); return; }
      await loadPortalData(); syncIdentity(); $("#memberLoading").hidden = true;
      navigate(location.hash.slice(1) || "dashboard", false);
    } catch (error) {
      $("#memberLoading").hidden = true; $("#memberAlert").hidden = false; $("#memberAlert").textContent = `Unable to open your Member Portal. ${error.message}`;
    }
  }

  function openContactDialog() { const form = $("#memberContactForm"); form.reset(); form.elements.phone.value = state.member.phone || ""; form.elements.email.value = state.member.email || ""; form.elements.address.value = state.member.address || ""; form.elements.profile_photo_url.value = state.member.profile_photo_url || ""; formError("#memberContactError"); $("#memberContactDialog").showModal(); icons(); }
  function openRequestDialog() { $("#memberRequestForm").reset(); formError("#memberRequestError"); $("#memberRequestDialog").showModal(); }

  async function saveContact(event) {
    event.preventDefault(); formError("#memberContactError"); if (!event.currentTarget.reportValidity()) return; const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const { error } = await client.rpc("update_own_member_contact", { new_phone: values.phone, new_email: values.email, new_address: values.address, new_profile_photo_url: values.profile_photo_url });
    if (error) return formError("#memberContactError", error.message);
    $("#memberContactDialog").close(); await loadPortalData(); syncIdentity(); render(); toast("Your contact information has been updated.");
  }

  async function saveRequest(event) {
    event.preventDefault(); formError("#memberRequestError"); if (!event.currentTarget.reportValidity()) return; const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const { error } = await client.from("member_profile_update_requests").insert({ member_id: state.member.id, requested_changes: { requested_change: values.details.trim() }, reason: values.reason.trim() });
    if (error) return formError("#memberRequestError", error.message);
    $("#memberRequestDialog").close(); await loadPortalData(); render(); toast("Your profile correction request has been submitted.");
  }

  async function saveRsvp(eventId, response) {
    const { error } = await client.from("event_rsvps").upsert({ event_id: eventId, member_id: state.member.id, response }, { onConflict: "event_id,member_id" });
    if (error) return toast(error.message, "error");
    await loadPortalData(); render(); toast(`Event response saved: ${response}.`);
  }

  async function savePreferences(event) {
    event.preventDefault(); const form = event.currentTarget;
    const payload = { user_id: state.user.id, email_notifications: form.elements.email_notifications.checked, event_reminders: form.elements.event_reminders.checked, communion_updates: form.elements.communion_updates.checked, updated_at: new Date().toISOString() };
    const { error } = await client.from("member_portal_preferences").upsert(payload, { onConflict: "user_id" });
    if (error) return toast(error.message, "error"); state.preferences = payload; toast("Notification preferences saved.");
  }

  async function savePassword(event) {
    event.preventDefault(); formError("#memberPasswordError"); if (!event.currentTarget.reportValidity()) return; const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (values.password !== values.confirm_password) return formError("#memberPasswordError", "The passwords do not match.");
    const { error } = await client.auth.updateUser({ password: values.password }); if (error) return formError("#memberPasswordError", error.message);
    event.currentTarget.reset(); toast("Your password has been updated.");
  }

  async function signOutOtherSessions() {
    const { error } = await client.auth.signOut({ scope: "others" });
    if (error) return toast(error.message, "error");
    toast("Other signed-in sessions have been closed.");
  }

  document.addEventListener("click", event => {
    const page = event.target.closest("[data-member-page]")?.dataset.memberPage; if (page) navigate(page);
    if (event.target.closest("[data-member-contact]")) openContactDialog();
    if (event.target.closest("[data-member-request]")) openRequestDialog();
    if (event.target.closest("[data-signout-other-sessions]")) signOutOtherSessions();
    const closeDialog = event.target.closest("[data-close-member-dialog]")?.dataset.closeMemberDialog; if (closeDialog) $("#" + closeDialog)?.close();
    const rsvp = event.target.closest("[data-event-rsvp]"); if (rsvp) saveRsvp(rsvp.dataset.eventRsvp, rsvp.dataset.response);
  });
  document.addEventListener("change", event => { if (event.target.id === "memberGivingFrom") { state.givingFrom = event.target.value; render(); } if (event.target.id === "memberGivingTo") { state.givingTo = event.target.value; render(); } if (event.target.id === "memberGivingCategory") { state.givingCategory = event.target.value; render(); } });
  document.addEventListener("submit", event => { if (event.target.id === "memberPreferencesForm") savePreferences(event); if (event.target.id === "memberPasswordForm") savePassword(event); });
  $("#memberContactForm").addEventListener("submit", saveContact); $("#memberRequestForm").addEventListener("submit", saveRequest);
  $("#memberMenuButton").addEventListener("click", openMobileNavigation); $("#memberSidebarClose").addEventListener("click", closeMobileNavigation); $("#memberMobileOverlay").addEventListener("click", closeMobileNavigation);
  $("#memberSignOut").addEventListener("click", async () => { await client?.auth.signOut(); location.replace("member-signin.html"); });
  window.addEventListener("popstate", () => navigate(location.hash.slice(1) || "dashboard", false));

  initialize();
})();
