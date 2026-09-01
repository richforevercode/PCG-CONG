(function () {
  "use strict";

  const FACILITY_TYPES = ["Sanctuary", "Hall", "Office", "Classroom", "Manse", "Store", "Kitchen", "Washroom", "Outdoor Space", "Other"];
  const FACILITY_STATUSES = ["Available", "In Use", "Under Maintenance", "Unavailable", "Archived"];
  const ASSET_CATEGORIES = ["Audio / Visual", "Furniture", "Musical Instrument", "Office Equipment", "Electrical", "Vehicle", "Kitchen Equipment", "Safety Equipment", "Building Equipment", "Other"];
  const ASSET_CONDITIONS = ["Excellent", "Good", "Fair", "Poor", "Unserviceable"];
  const ASSET_STATUSES = ["In Service", "In Storage", "Under Maintenance", "Disposed", "Lost"];
  const MAINTENANCE_TYPES = ["Inspection", "Preventive Service", "Repair", "Cleaning", "Safety Check", "Renovation", "Other"];
  const MAINTENANCE_STATUSES = ["Reported", "Scheduled", "In Progress", "Completed", "Cancelled"];
  const BOOKING_STATUSES = ["Pending", "Approved", "Completed", "Cancelled"];
  const state = { client: null, userId: null, permissions: [], events: [], facilities: [], assets: [], maintenance: [], bookings: [], section: "overview", search: "", status: "all", bound: false };
  const $ = selector => document.querySelector(selector);
  const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const can = permission => state.permissions.includes(permission);
  const notify = (message, type) => window.PCGApp?.toast(message, type);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const money = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 });
  const num = value => Number(value || 0);
  const options = (values, selected = "") => values.map(value => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(value)}</option>`).join("");
  const facilityFor = id => state.facilities.find(item => item.id === id);
  const assetFor = id => state.assets.find(item => item.id === id);
  const targetName = item => item.asset_id ? `${assetFor(item.asset_id)?.asset_tag || "Asset"} - ${assetFor(item.asset_id)?.name || "Unknown asset"}` : facilityFor(item.facility_id)?.name || "Unknown facility";
  const formatDate = value => {
    if (!value) return "Not scheduled";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GH", { day: "numeric", month: "short", year: "numeric" }).format(date);
  };
  const overdue = item => item.status !== "Completed" && item.status !== "Cancelled" && item.scheduled_for && item.scheduled_for < todayIso();
  const statusClass = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const matchesSearch = values => !state.search.trim() || values.join(" ").toLowerCase().includes(state.search.trim().toLowerCase());

  function mount() {
    const root = $("#propertyManagementRoot");
    if (!root || root.dataset.mounted) return;
    root.dataset.mounted = "true";
    root.innerHTML = `<div id="propertyWorkspace"></div>
      <dialog id="facilityDialog" class="management-dialog property-dialog"><form id="facilityForm"><div class="dialog-header"><div><p class="eyebrow">FACILITY REGISTER</p><h3 id="facilityDialogTitle">Add facility</h3></div><button class="icon-btn" type="button" data-close-property="facilityDialog" aria-label="Close"><i data-lucide="x"></i></button></div><div class="dialog-body"><input type="hidden" name="id" /><label class="full">Facility name<input name="name" required maxlength="150" placeholder="e.g. Main Sanctuary" /></label><label>Facility type<select name="facility_type">${options(FACILITY_TYPES)}</select></label><label>Status<select name="status">${options(FACILITY_STATUSES)}</select></label><label>Capacity<input name="capacity" type="number" min="0" step="1" value="0" /></label><label>Location<input name="location" maxlength="250" placeholder="Building, floor, or area" /></label><label class="full">Description<textarea name="description" maxlength="2000" rows="4"></textarea></label></div><div class="dialog-footer"><button class="secondary-btn" type="button" data-close-property="facilityDialog">Cancel</button><button class="primary-btn" type="submit">Save facility</button></div></form></dialog>
      <dialog id="assetDialog" class="management-dialog property-dialog"><form id="assetForm"><div class="dialog-header"><div><p class="eyebrow">ASSET INVENTORY</p><h3 id="assetDialogTitle">Add asset</h3></div><button class="icon-btn" type="button" data-close-property="assetDialog" aria-label="Close"><i data-lucide="x"></i></button></div><div class="dialog-body"><input type="hidden" name="id" /><label>Asset tag<input name="asset_tag" required maxlength="80" placeholder="AST-2026-001" /></label><label>Asset name<input name="name" required maxlength="200" /></label><label>Category<select name="category">${options(ASSET_CATEGORIES)}</select></label><label>Facility / location<select name="facility_id"></select></label><label>Condition<select name="condition">${options(ASSET_CONDITIONS)}</select></label><label>Status<select name="status">${options(ASSET_STATUSES)}</select></label><label>Acquisition date<input name="acquisition_date" type="date" /></label><label>Acquisition cost (GH&#8373;)<input name="acquisition_cost" type="number" min="0" step="0.01" value="0" /></label><label>Current value (GH&#8373;)<input name="current_value" type="number" min="0" step="0.01" /></label><label>Serial number<input name="serial_number" maxlength="150" /></label><label>Supplier<input name="supplier" maxlength="200" /></label><label>Custodian / responsible person<input name="custodian" maxlength="200" /></label><label>Warranty expires<input name="warranty_expires" type="date" /></label><label>Last inspection<input name="last_inspection" type="date" /></label><label>Next inspection<input name="next_inspection" type="date" /></label><label class="full">Notes<textarea name="notes" maxlength="3000" rows="4"></textarea></label></div><div class="dialog-footer"><button class="secondary-btn" type="button" data-close-property="assetDialog">Cancel</button><button class="primary-btn" type="submit">Save asset</button></div></form></dialog>
      <dialog id="maintenanceDialog" class="management-dialog property-dialog"><form id="maintenanceForm"><div class="dialog-header"><div><p class="eyebrow">MAINTENANCE WORK</p><h3 id="maintenanceDialogTitle">Log maintenance</h3></div><button class="icon-btn" type="button" data-close-property="maintenanceDialog" aria-label="Close"><i data-lucide="x"></i></button></div><div class="dialog-body"><input type="hidden" name="id" /><label>Record applies to<select name="target_type"><option value="asset">Asset</option><option value="facility">Facility</option></select></label><label>Asset or facility<select name="target_id" required></select></label><label class="full">Work title<input name="title" required maxlength="200" placeholder="e.g. Service sanctuary sound mixer" /></label><label>Maintenance type<select name="maintenance_type">${options(MAINTENANCE_TYPES)}</select></label><label>Priority<select name="priority"><option>Low</option><option selected>Normal</option><option>High</option><option>Urgent</option></select></label><label>Status<select name="status">${options(MAINTENANCE_STATUSES)}</select></label><label>Reported on<input name="reported_on" type="date" required /></label><label>Scheduled for<input name="scheduled_for" type="date" /></label><label>Completed on<input name="completed_on" type="date" /></label><label>Assigned to<input name="assigned_to" maxlength="200" /></label><label>Vendor / contractor<input name="vendor" maxlength="200" /></label><label>Estimated cost (GH&#8373;)<input name="estimated_cost" type="number" min="0" step="0.01" value="0" /></label><label>Actual cost (GH&#8373;)<input name="actual_cost" type="number" min="0" step="0.01" value="0" /></label><label class="full">Work notes<textarea name="notes" maxlength="4000" rows="5"></textarea></label></div><div class="dialog-footer"><button class="secondary-btn" type="button" data-close-property="maintenanceDialog">Cancel</button><button class="primary-btn" type="submit">Save maintenance</button></div></form></dialog>
      <dialog id="bookingDialog" class="management-dialog property-dialog"><form id="bookingForm"><div class="dialog-header"><div><p class="eyebrow">FACILITY BOOKING</p><h3 id="bookingDialogTitle">Book facility</h3></div><button class="icon-btn" type="button" data-close-property="bookingDialog" aria-label="Close"><i data-lucide="x"></i></button></div><div class="dialog-body"><input type="hidden" name="id" /><label>Facility<select name="facility_id" required></select></label><label>Linked church programme<select name="event_id"></select></label><label class="full">Booking title<input name="title" required maxlength="200" /></label><label>Booking date<input name="booking_date" type="date" required /></label><label>Start time<input name="start_time" type="time" required /></label><label>End time<input name="end_time" type="time" required /></label><label>Requested by<input name="requested_by" required maxlength="200" /></label><label>Contact phone<input name="contact_phone" maxlength="50" /></label><label>Status<select name="status">${options(BOOKING_STATUSES)}</select><small class="field-note">Approved bookings cannot overlap at the same facility.</small></label><label class="full">Setup / access notes<textarea name="setup_notes" maxlength="3000" rows="4"></textarea></label></div><div class="dialog-footer"><button class="secondary-btn" type="button" data-close-property="bookingDialog">Cancel</button><button class="primary-btn" type="submit">Save booking</button></div></form></dialog>`;
  }

  function metricsMarkup() {
    const activeAssets = state.assets.filter(item => !["Disposed", "Lost"].includes(item.status));
    const attention = activeAssets.filter(item => ["Poor", "Unserviceable"].includes(item.condition) || (item.next_inspection && item.next_inspection <= todayIso()));
    const openMaintenance = state.maintenance.filter(item => !["Completed", "Cancelled"].includes(item.status));
    const upcoming = state.bookings.filter(item => item.status === "Approved" && item.booking_date >= todayIso());
    return `<div class="property-metrics">${[
      [activeAssets.length,"Active assets",money.format(activeAssets.reduce((sum,item) => sum + num(item.current_value ?? item.acquisition_cost),0)),"package-check","#0a3995"],
      [state.facilities.filter(item => item.status !== "Archived").length,"Facilities","registered spaces","building-2","#6941c6"],
      [openMaintenance.length,"Open maintenance",`${openMaintenance.filter(overdue).length} overdue`,"wrench","#b54708"],
      [upcoming.length,"Upcoming bookings",`${attention.length} assets need attention`,"calendar-check-2","#087a38"]
    ].map(([value,label,note,icon,color]) => `<article style="--property-tone:${color}"><span><i data-lucide="${icon}"></i></span><div><strong>${esc(value)}</strong><b>${esc(label)}</b><small>${esc(note)}</small></div></article>`).join("")}</div>`;
  }

  function statusPill(status) { return `<span class="property-status ${statusClass(status)}">${esc(status)}</span>`; }
  function emptyMarkup(icon, title, note) { return `<div class="property-empty"><i data-lucide="${icon}"></i><strong>${esc(title)}</strong><span>${esc(note)}</span></div>`; }
  function toolbarMarkup(statuses, placeholder) {
    return `<div class="property-toolbar"><label><i data-lucide="search"></i><input id="propertySearch" type="search" value="${esc(state.search)}" placeholder="${esc(placeholder)}" /></label><select id="propertyStatusFilter"><option value="all">All statuses</option>${options(statuses,state.status)}</select></div>`;
  }

  function renderOverview() {
    const maintenance = state.maintenance.filter(item => !["Completed","Cancelled"].includes(item.status)).sort((a,b) => Number(overdue(b)) - Number(overdue(a)) || String(a.scheduled_for || "9999").localeCompare(String(b.scheduled_for || "9999"))).slice(0,6);
    const bookings = state.bookings.filter(item => !["Cancelled","Completed"].includes(item.status) && item.booking_date >= todayIso()).sort((a,b) => `${a.booking_date}${a.start_time}`.localeCompare(`${b.booking_date}${b.start_time}`)).slice(0,6);
    return `${metricsMarkup()}<div class="property-overview-grid"><article class="card property-panel"><div class="property-panel-title"><div><p>MAINTENANCE</p><h3>Work requiring attention</h3></div><button type="button" data-property-tab="maintenance">View all</button></div><div class="property-compact-list">${maintenance.length ? maintenance.map(item => `<button type="button" data-edit-maintenance="${item.id}"><span class="property-list-icon ${overdue(item) ? "danger" : "warning"}"><i data-lucide="${overdue(item) ? "alarm-clock" : "wrench"}"></i></span><span><strong>${esc(item.title)}</strong><small>${esc(targetName(item))}</small></span><span><b>${esc(item.priority)}</b><small>${overdue(item) ? "Overdue: " : "Due: "}${esc(formatDate(item.scheduled_for))}</small></span></button>`).join("") : emptyMarkup("badge-check","Nothing currently open","New maintenance work will appear here.")}</div></article><article class="card property-panel"><div class="property-panel-title"><div><p>FACILITY CALENDAR</p><h3>Upcoming bookings</h3></div><button type="button" data-property-tab="bookings">View all</button></div><div class="property-compact-list">${bookings.length ? bookings.map(item => `<button type="button" data-edit-booking="${item.id}"><span class="property-date-tile"><b>${esc(new Date(`${item.booking_date}T00:00:00`).toLocaleDateString("en-GH",{day:"2-digit"}))}</b><small>${esc(new Date(`${item.booking_date}T00:00:00`).toLocaleDateString("en-GH",{month:"short"}))}</small></span><span><strong>${esc(item.title)}</strong><small>${esc(facilityFor(item.facility_id)?.name || "Unknown facility")}</small></span><span>${statusPill(item.status)}<small>${esc(item.start_time.slice(0,5))} - ${esc(item.end_time.slice(0,5))}</small></span></button>`).join("") : emptyMarkup("calendar-check","No upcoming bookings","Approved and pending bookings will appear here.")}</div></article></div>`;
  }

  function filteredAssets() { return state.assets.filter(item => (state.status === "all" || item.status === state.status) && matchesSearch([item.asset_tag,item.name,item.category,item.serial_number,item.custodian,facilityFor(item.facility_id)?.name || ""])); }
  function renderAssets() {
    const records = filteredAssets();
    return `${toolbarMarkup(ASSET_STATUSES,"Search asset tag, name, serial, custodian, or location...")}<article class="card property-table-card"><div class="property-table-scroll"><table><thead><tr><th>Asset</th><th>Category / location</th><th>Condition</th><th>Value</th><th>Next inspection</th><th>Status</th><th></th></tr></thead><tbody>${records.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.asset_tag)}${item.serial_number ? ` &middot; S/N ${esc(item.serial_number)}` : ""}</small></td><td>${esc(item.category)}<small>${esc(facilityFor(item.facility_id)?.name || "Unassigned")}</small></td><td><span class="condition-dot ${statusClass(item.condition)}"></span>${esc(item.condition)}</td><td>${esc(money.format(num(item.current_value ?? item.acquisition_cost)))}</td><td class="${item.next_inspection && item.next_inspection <= todayIso() ? "property-overdue" : ""}">${esc(formatDate(item.next_inspection))}</td><td>${statusPill(item.status)}</td><td><div class="row-actions">${can("property.manage") ? `<button class="icon-btn" type="button" data-maintain-asset="${item.id}" title="Log maintenance"><i data-lucide="wrench"></i></button><button class="icon-btn" type="button" data-edit-asset="${item.id}" title="Edit asset"><i data-lucide="pencil"></i></button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>${records.length ? `<div class="property-table-footer">${records.length} asset${records.length === 1 ? "" : "s"}<button type="button" data-export-assets><i data-lucide="download"></i> Export CSV</button></div>` : emptyMarkup("package-search","No assets found","Adjust the filter or add an asset to the inventory.")}</article>`;
  }

  function filteredFacilities() { return state.facilities.filter(item => (state.status === "all" || item.status === state.status) && matchesSearch([item.name,item.facility_type,item.location,item.description])); }
  function renderFacilities() {
    const records = filteredFacilities();
    return `${toolbarMarkup(FACILITY_STATUSES,"Search facility name, type, or location...")}<div class="facility-grid">${records.length ? records.map(item => { const assets = state.assets.filter(asset => asset.facility_id === item.id && !["Disposed","Lost"].includes(asset.status)); const open = state.maintenance.filter(job => job.facility_id === item.id && !["Completed","Cancelled"].includes(job.status)); return `<article class="card facility-card"><div class="facility-card-head"><span><i data-lucide="${item.facility_type === "Sanctuary" ? "church" : item.facility_type === "Outdoor Space" ? "trees" : "building-2"}"></i></span>${statusPill(item.status)}</div><h3>${esc(item.name)}</h3><p>${esc(item.facility_type)}${item.location ? ` &middot; ${esc(item.location)}` : ""}</p><div class="facility-facts"><span><b>${item.capacity}</b> capacity</span><span><b>${assets.length}</b> assets</span><span class="${open.length ? "attention" : ""}"><b>${open.length}</b> open jobs</span></div>${item.description ? `<small>${esc(item.description)}</small>` : ""}<div class="facility-actions">${can("property.manage") ? `<button class="secondary-btn" type="button" data-book-facility="${item.id}"><i data-lucide="calendar-plus"></i> Book</button><button class="icon-btn" type="button" data-maintain-facility="${item.id}" title="Log maintenance"><i data-lucide="wrench"></i></button><button class="icon-btn" type="button" data-edit-facility="${item.id}" title="Edit facility"><i data-lucide="pencil"></i></button>` : ""}</div></article>`; }).join("") : emptyMarkup("building-2","No facilities found","Adjust the filter or register the first facility.")}</div>`;
  }

  function filteredMaintenance() { return state.maintenance.filter(item => (state.status === "all" || item.status === state.status) && matchesSearch([item.title,item.maintenance_type,item.priority,item.assigned_to,item.vendor,targetName(item)])); }
  function renderMaintenance() {
    const records = filteredMaintenance().sort((a,b) => Number(overdue(b))-Number(overdue(a)) || String(a.scheduled_for || "9999").localeCompare(String(b.scheduled_for || "9999")));
    return `${toolbarMarkup(MAINTENANCE_STATUSES,"Search work, asset, facility, assignee, or vendor...")}<article class="card property-table-card"><div class="property-table-scroll"><table><thead><tr><th>Maintenance work</th><th>Asset / facility</th><th>Schedule</th><th>Priority</th><th>Cost</th><th>Status</th><th></th></tr></thead><tbody>${records.map(item => `<tr><td><strong>${esc(item.title)}</strong><small>${esc(item.maintenance_type)}</small></td><td>${esc(targetName(item))}<small>${esc(item.assigned_to || item.vendor || "Unassigned")}</small></td><td class="${overdue(item) ? "property-overdue" : ""}">${overdue(item) ? "Overdue &middot; " : ""}${esc(formatDate(item.scheduled_for))}<small>Reported ${esc(formatDate(item.reported_on))}</small></td><td><span class="property-priority ${statusClass(item.priority)}">${esc(item.priority)}</span></td><td>${esc(money.format(num(item.actual_cost || item.estimated_cost)))}</td><td>${statusPill(item.status)}</td><td><div class="row-actions">${can("property.manage") ? item.status !== "Completed" && item.status !== "Cancelled" ? `<button class="icon-btn complete" type="button" data-complete-maintenance="${item.id}" title="Mark completed"><i data-lucide="check"></i></button><button class="icon-btn" type="button" data-edit-maintenance="${item.id}" title="Edit"><i data-lucide="pencil"></i></button>` : `<button class="icon-btn" type="button" data-edit-maintenance="${item.id}" title="View or edit"><i data-lucide="pencil"></i></button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>${records.length ? `<div class="property-table-footer">${records.length} maintenance record${records.length === 1 ? "" : "s"}</div>` : emptyMarkup("wrench","No maintenance records found","Log an inspection, repair, or preventive service.")}</article>`;
  }

  function filteredBookings() { return state.bookings.filter(item => (state.status === "all" || item.status === state.status) && matchesSearch([item.title,item.requested_by,item.contact_phone,facilityFor(item.facility_id)?.name || ""])); }
  function renderBookings() {
    const records = filteredBookings().sort((a,b) => `${b.booking_date}${b.start_time}`.localeCompare(`${a.booking_date}${a.start_time}`));
    return `${toolbarMarkup(BOOKING_STATUSES,"Search booking, requester, contact, or facility...")}<article class="card property-table-card"><div class="property-table-scroll"><table><thead><tr><th>Booking</th><th>Facility</th><th>Date & time</th><th>Requested by</th><th>Status</th><th></th></tr></thead><tbody>${records.map(item => `<tr><td><strong>${esc(item.title)}</strong><small>${item.event_id ? "Linked church programme" : "Independent booking"}</small></td><td>${esc(facilityFor(item.facility_id)?.name || "Unknown facility")}</td><td>${esc(formatDate(item.booking_date))}<small>${esc(item.start_time.slice(0,5))} - ${esc(item.end_time.slice(0,5))}</small></td><td>${esc(item.requested_by)}<small>${esc(item.contact_phone)}</small></td><td>${statusPill(item.status)}</td><td><div class="row-actions">${can("property.manage") ? item.status === "Pending" ? `<button class="icon-btn complete" type="button" data-approve-booking="${item.id}" title="Approve"><i data-lucide="check"></i></button><button class="icon-btn" type="button" data-edit-booking="${item.id}"><i data-lucide="pencil"></i></button>` : `<button class="icon-btn" type="button" data-edit-booking="${item.id}"><i data-lucide="pencil"></i></button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>${records.length ? `<div class="property-table-footer">${records.length} booking${records.length === 1 ? "" : "s"}</div>` : emptyMarkup("calendar-x","No bookings found","Create a booking to reserve a church facility.")}</article>`;
  }

  function render() {
    const workspace = $("#propertyWorkspace");
    if (!workspace) return;
    const titles = { overview:["Assets & Facilities","Monitor church property, maintenance, and facility use."], assets:["Asset inventory","Track ownership, condition, value, location, and inspections."], facilities:["Facilities","Manage church spaces, capacity, availability, and care."], maintenance:["Maintenance","Coordinate inspections, repairs, servicing, and renovation."], bookings:["Facility bookings","Reserve church spaces and prevent approved schedule conflicts."] };
    const action = { overview:["asset","Add asset","package-plus"], assets:["asset","Add asset","package-plus"], facilities:["facility","Add facility","building-2"], maintenance:["maintenance","Log maintenance","wrench"], bookings:["booking","New booking","calendar-plus"] }[state.section];
    const content = state.section === "overview" ? renderOverview() : state.section === "assets" ? renderAssets() : state.section === "facilities" ? renderFacilities() : state.section === "maintenance" ? renderMaintenance() : renderBookings();
    workspace.innerHTML = `<div class="page-heading property-heading"><div><p class="breadcrumb">Home <i data-lucide="chevron-right"></i> Administration <i data-lucide="chevron-right"></i> Property</p><h2>${titles[state.section][0]}</h2><p>${titles[state.section][1]}</p></div>${can("property.manage") ? `<button class="primary-btn" type="button" data-add-property="${action[0]}"><i data-lucide="${action[2]}"></i> ${action[1]}</button>` : ""}</div><nav class="property-tabs" aria-label="Property management sections">${[["overview","Overview"],["assets","Assets"],["facilities","Facilities"],["maintenance","Maintenance"],["bookings","Bookings"]].map(([value,label]) => `<button type="button" class="${state.section === value ? "active" : ""}" data-property-tab="${value}">${label}</button>`).join("")}</nav>${content}`;
    window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  }

  async function load() {
    const results = await Promise.all([
      state.client.from("church_facilities").select("*").order("name"),
      state.client.from("church_assets").select("*").order("name"),
      state.client.from("property_maintenance").select("*").order("reported_on",{ascending:false}),
      state.client.from("facility_bookings").select("*").order("booking_date",{ascending:false}).order("start_time",{ascending:false})
    ]);
    const failure = results.find(result => result.error);
    if (failure) throw failure.error;
    [state.facilities,state.assets,state.maintenance,state.bookings] = results.map(result => result.data || []);
    render();
  }

  function facilityOptions(selected = "") { return `<option value="">Unassigned</option>${state.facilities.filter(item => item.status !== "Archived" || item.id === selected).map(item => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${esc(item.name)}</option>`).join("")}`; }
  function eventOptions(selected = "") { return `<option value="">No linked programme</option>${state.events.map(item => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${esc(item.title)} - ${esc(formatDate(item.event_date))}</option>`).join("")}`; }
  function fillForm(form, item, defaults = {}) { Object.entries({ ...defaults, ...(item || {}) }).forEach(([key,value]) => { if (form.elements[key]) form.elements[key].value = value ?? ""; }); }

  function openFacility(item = null) {
    const form = $("#facilityForm"); form.reset(); fillForm(form,item,{status:"Available",facility_type:"Sanctuary",capacity:0});
    $("#facilityDialogTitle").textContent = item ? "Edit facility" : "Add facility"; $("#facilityDialog").showModal();
  }
  function suggestedAssetTag() { const year = todayIso().slice(0,4); const expression = new RegExp(`^AST-${year}-(\\d+)$`,`i`); const next = state.assets.reduce((max,item) => { const match = item.asset_tag.match(expression); return match ? Math.max(max,Number(match[1])) : max; },0)+1; return `AST-${year}-${String(next).padStart(3,"0")}`; }
  function openAsset(item = null) {
    const form = $("#assetForm"); form.reset(); form.elements.facility_id.innerHTML = facilityOptions(item?.facility_id); fillForm(form,item,{asset_tag:suggestedAssetTag(),category:"Audio / Visual",condition:"Good",status:"In Service",acquisition_cost:0});
    $("#assetDialogTitle").textContent = item ? "Edit asset" : "Add asset"; $("#assetDialog").showModal();
  }
  function syncMaintenanceTargets(selected = "") {
    const form = $("#maintenanceForm"); const assetTarget = form.elements.target_type.value === "asset";
    const records = assetTarget ? state.assets.filter(item => !["Disposed","Lost"].includes(item.status)) : state.facilities.filter(item => item.status !== "Archived");
    form.elements.target_id.innerHTML = `<option value="">Select ${assetTarget ? "asset" : "facility"}</option>${records.map(item => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${esc(assetTarget ? `${item.asset_tag} - ${item.name}` : item.name)}</option>`).join("")}`;
  }
  function openMaintenance(item = null, targetType = "asset", targetId = "") {
    const form = $("#maintenanceForm"); form.reset(); form.elements.target_type.value = item?.asset_id ? "asset" : item?.facility_id ? "facility" : targetType; syncMaintenanceTargets(item?.asset_id || item?.facility_id || targetId); fillForm(form,item,{reported_on:todayIso(),priority:"Normal",status:"Reported",maintenance_type:"Inspection",estimated_cost:0,actual_cost:0});
    $("#maintenanceDialogTitle").textContent = item ? "Edit maintenance" : "Log maintenance"; $("#maintenanceDialog").showModal();
  }
  function openBooking(item = null, facilityId = "") {
    const form = $("#bookingForm"); form.reset(); form.elements.facility_id.innerHTML = facilityOptions(item?.facility_id || facilityId); form.elements.event_id.innerHTML = eventOptions(item?.event_id); fillForm(form,item,{facility_id:facilityId,booking_date:todayIso(),start_time:"09:00",end_time:"10:00",status:"Pending"});
    $("#bookingDialogTitle").textContent = item ? "Edit facility booking" : "Book facility"; $("#bookingDialog").showModal();
  }
  function openPrimary() { if (state.section === "facilities") openFacility(); else if (state.section === "maintenance") openMaintenance(); else if (state.section === "bookings") openBooking(); else openAsset(); }

  async function save(table, id, payload, dialogId, message) {
    const query = id ? state.client.from(table).update(payload).eq("id",id) : state.client.from(table).insert(payload);
    const { error } = await query;
    if (error) throw error;
    $(dialogId).close(); await load(); notify(message);
  }
  async function saveFacility(event) { event.preventDefault(); const form=event.currentTarget; if(!form.reportValidity())return; const v=Object.fromEntries(new FormData(form)); try { await save("church_facilities",v.id,{name:v.name.trim(),facility_type:v.facility_type,status:v.status,capacity:num(v.capacity),location:v.location.trim(),description:v.description.trim()},"#facilityDialog",v.id?"Facility updated.":"Facility registered."); } catch(error){ notify(error.code==="23505"?"A facility with that name already exists.":error.message,"error"); } }
  async function saveAsset(event) { event.preventDefault(); const form=event.currentTarget; if(!form.reportValidity())return; const v=Object.fromEntries(new FormData(form)); if(v.last_inspection&&v.next_inspection&&v.next_inspection<v.last_inspection)return notify("Next inspection cannot be before the last inspection.","error"); const payload={asset_tag:v.asset_tag.trim(),name:v.name.trim(),category:v.category,facility_id:v.facility_id||null,condition:v.condition,status:v.status,acquisition_date:v.acquisition_date||null,acquisition_cost:num(v.acquisition_cost),current_value:v.current_value===""?null:num(v.current_value),serial_number:v.serial_number.trim(),supplier:v.supplier.trim(),custodian:v.custodian.trim(),warranty_expires:v.warranty_expires||null,last_inspection:v.last_inspection||null,next_inspection:v.next_inspection||null,notes:v.notes.trim()}; try{await save("church_assets",v.id,payload,"#assetDialog",v.id?"Asset updated.":"Asset added to inventory.");}catch(error){notify(error.code==="23505"?"That asset tag or serial number is already in use.":error.message,"error");} }
  async function saveMaintenance(event) { event.preventDefault(); const form=event.currentTarget;if(!form.reportValidity())return;const v=Object.fromEntries(new FormData(form));if(v.scheduled_for&&v.scheduled_for<v.reported_on)return notify("Scheduled date cannot be before the report date.","error"); const payload={asset_id:v.target_type==="asset"?v.target_id:null,facility_id:v.target_type==="facility"?v.target_id:null,title:v.title.trim(),maintenance_type:v.maintenance_type,priority:v.priority,status:v.status,reported_on:v.reported_on,scheduled_for:v.scheduled_for||null,completed_on:v.status==="Completed"?(v.completed_on||todayIso()):null,assigned_to:v.assigned_to.trim(),vendor:v.vendor.trim(),estimated_cost:num(v.estimated_cost),actual_cost:num(v.actual_cost),notes:v.notes.trim()};try{await save("property_maintenance",v.id,payload,"#maintenanceDialog",v.id?"Maintenance record updated.":"Maintenance work logged.");}catch(error){notify(error.message,"error");} }
  async function saveBooking(event) { event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const v=Object.fromEntries(new FormData(form));if(v.end_time<=v.start_time)return notify("End time must be after start time.","error");const payload={facility_id:v.facility_id,event_id:v.event_id||null,title:v.title.trim(),booking_date:v.booking_date,start_time:v.start_time,end_time:v.end_time,requested_by:v.requested_by.trim(),contact_phone:v.contact_phone.trim(),status:v.status,setup_notes:v.setup_notes.trim()};try{await save("facility_bookings",v.id,payload,"#bookingDialog",v.id?"Booking updated.":"Facility booking created.");}catch(error){notify(error.message,"error");} }
  async function quickUpdate(table,id,payload,message){const{error}=await state.client.from(table).update(payload).eq("id",id);if(error)return notify(error.message,"error");await load();notify(message);}

  function exportAssets() {
    const records=filteredAssets();if(!records.length)return notify("There are no assets to export.","error");const keys=["asset_tag","name","category","facility","condition","status","acquisition_date","acquisition_cost","current_value","serial_number","supplier","custodian","warranty_expires","last_inspection","next_inspection","notes"];const safe=value=>{let text=String(value??"");if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};const rows=records.map(item=>({...item,facility:facilityFor(item.facility_id)?.name||""}));const csv=[keys,...rows.map(item=>keys.map(key=>item[key]??""))].map(row=>row.map(safe).join(",")).join("\r\n");const link=document.createElement("a");link.href=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));link.download=`resurrection-assets-${todayIso()}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }

  function bind() {
    if(state.bound)return;state.bound=true;
    document.addEventListener("click",event=>{
      const tab=event.target.closest("[data-property-tab]")?.dataset.propertyTab;if(tab){state.section=tab;state.search="";state.status="all";render();}
      const add=event.target.closest("[data-add-property]")?.dataset.addProperty;if(add){if(add==="facility")openFacility();else if(add==="maintenance")openMaintenance();else if(add==="booking")openBooking();else openAsset();}
      const editFacility=event.target.closest("[data-edit-facility]")?.dataset.editFacility;if(editFacility)openFacility(facilityFor(editFacility));
      const editAsset=event.target.closest("[data-edit-asset]")?.dataset.editAsset;if(editAsset)openAsset(assetFor(editAsset));
      const editMaintenance=event.target.closest("[data-edit-maintenance]")?.dataset.editMaintenance;if(editMaintenance)openMaintenance(state.maintenance.find(item=>item.id===editMaintenance));
      const editBooking=event.target.closest("[data-edit-booking]")?.dataset.editBooking;if(editBooking)openBooking(state.bookings.find(item=>item.id===editBooking));
      const maintainAsset=event.target.closest("[data-maintain-asset]")?.dataset.maintainAsset;if(maintainAsset)openMaintenance(null,"asset",maintainAsset);
      const maintainFacility=event.target.closest("[data-maintain-facility]")?.dataset.maintainFacility;if(maintainFacility)openMaintenance(null,"facility",maintainFacility);
      const bookFacility=event.target.closest("[data-book-facility]")?.dataset.bookFacility;if(bookFacility)openBooking(null,bookFacility);
      const complete=event.target.closest("[data-complete-maintenance]")?.dataset.completeMaintenance;if(complete)quickUpdate("property_maintenance",complete,{status:"Completed",completed_on:todayIso()},"Maintenance marked completed.");
      const approve=event.target.closest("[data-approve-booking]")?.dataset.approveBooking;if(approve)quickUpdate("facility_bookings",approve,{status:"Approved"},"Facility booking approved.");
      if(event.target.closest("[data-export-assets]"))exportAssets();
      const close=event.target.closest("[data-close-property]")?.dataset.closeProperty;if(close)$("#"+close)?.close();
    });
    document.addEventListener("input",event=>{if(event.target.id==="propertySearch"){state.search=event.target.value;render();const input=$("#propertySearch");input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}});
    document.addEventListener("change",event=>{
      if(event.target.id==="propertyStatusFilter"){state.status=event.target.value;render();}
      if(event.target.closest("#maintenanceForm")&&event.target.name==="target_type")syncMaintenanceTargets();
      if(event.target.closest("#bookingForm")&&event.target.name==="event_id"&&event.target.value){const form=$("#bookingForm");const linked=state.events.find(item=>item.id===event.target.value);if(linked){const start=linked.start_time?.slice(0,5)||"09:00";const [hour,minute]=start.split(":").map(Number);form.elements.title.value=linked.title;form.elements.booking_date.value=linked.event_date;form.elements.start_time.value=start;form.elements.end_time.value=hour<23?`${String(hour+1).padStart(2,"0")}:${String(minute).padStart(2,"0")}`:"23:59";}}
    });
    $("#facilityForm").addEventListener("submit",saveFacility);$("#assetForm").addEventListener("submit",saveAsset);$("#maintenanceForm").addEventListener("submit",saveMaintenance);$("#bookingForm").addEventListener("submit",saveBooking);
  }

  async function initialize({client,userId,permissions,events}){state.client=client;state.userId=userId;state.permissions=permissions||[];state.events=events||[];mount();bind();await load();}
  function syncEvents(events){state.events=events||[];}
  window.PropertyManagement={initialize,render,openPrimary,syncEvents};
})();
