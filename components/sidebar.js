(function () {
  "use strict";

  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <div class="brand-mark" aria-hidden="true">
        <img src="assets/pcg-crest.png" alt="" />
      </div>
      <div class="brand-copy">
        <p class="brand-kicker">Presbyterian Church of Ghana</p>
        <h1>Resurrection</h1>
        <p class="brand-subtitle">Congregation</p>
      </div>
      <button class="sidebar-close" id="sidebarCloseBtn" type="button" aria-label="Close navigation">
        <i data-lucide="x"></i>
      </button>
    </div>

    <div class="sidebar-scroll" id="sidebarScroll">
      <nav class="side-nav" id="sideNav" aria-label="Church management">
        <button class="nav-item active" data-page="dashboard" data-requires="dashboard.view"><i data-lucide="layout-dashboard"></i><span>Dashboard</span></button>
        <button class="nav-item" data-page="members" data-requires="members.view"><i data-lucide="users"></i><span>Membership</span><b id="memberNavCount">0</b></button>
        <button class="nav-item" data-page="attendance" data-requires="attendance.view"><i data-lucide="clipboard-check"></i><span>Attendance</span></button>
        <button class="nav-item" data-page="communion" data-requires="communion.view"><i data-lucide="church"></i><span>Communion</span></button>
        <div class="finance-nav-group" data-requires="finance.view">
          <button class="nav-item" data-page="finance" data-finance-section="dashboard"><i data-lucide="wallet-cards"></i><span>Finance</span></button>
          <div class="finance-subnav" aria-label="Finance navigation">
            <button data-page="finance" data-finance-section="dashboard">Overview</button>
            <button data-page="finance" data-finance-section="tithes">Tithe</button>
            <button data-page="finance" data-finance-section="vto">Voluntary Thanks Offering (VTO)</button>
            <button data-page="finance" data-finance-section="adult">Adult Offertory</button>
            <button data-page="finance" data-finance-section="jy">Junior Youth (JY) Offertory</button>
            <button data-page="finance" data-finance-section="children">Children Service Offertory</button>
            <div class="finance-harvest-nav-group">
              <button data-page="finance" data-finance-section="miniHarvest">Day Born Mini-Harvest</button>
              <div class="finance-harvest-subnav" aria-label="Day Born Mini-Harvest days">
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Sunday">Sunday</button>
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Monday">Monday</button>
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Tuesday">Tuesday</button>
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Wednesday">Wednesday</button>
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Thursday">Thursday</button>
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Friday">Friday</button>
                <button data-page="finance" data-finance-section="miniHarvest" data-finance-day="Saturday">Saturday</button>
              </div>
            </div>
            <button data-page="finance" data-finance-section="mainHarvest">Main Harvest</button>
            <button data-page="finance" data-finance-section="remittances">60/40 Distribution</button>
            <button data-page="finance" data-finance-section="reports">Financial Reports</button>
            <button data-page="finance" data-finance-section="collections">All Collections</button>
            <button data-page="finance" data-finance-section="expenses">Expenses</button>
            <button data-page="finance" data-finance-section="funds">Funds / Accounts</button>
            <button data-page="finance" data-finance-section="settings">Finance Settings</button>
            <button data-page="finance" data-finance-section="audit">Audit Trail</button>
          </div>
        </div>
        <button class="nav-item" data-page="events" data-requires="events.view"><i data-lucide="calendar-days"></i><span>Events</span></button>
        <button class="nav-item" data-page="announcements" data-requires="announcements.view"><i data-lucide="megaphone"></i><span>Announcements</span></button>
        <button class="nav-item" data-page="history" data-requires="history.view"><i data-lucide="landmark"></i><span>Church History</span></button>
        <button class="nav-item" data-page="reports" data-requires="reports.view"><i data-lucide="chart-no-axes-combined"></i><span>Reports</span></button>
        <button class="nav-item" data-page="users" data-requires="users.manage"><i data-lucide="shield-user"></i><span>Users & roles</span></button>
      </nav>

      <button class="sidebar-new" id="quickAddBtn" type="button"><i data-lucide="plus"></i><span>New entry</span></button>
    </div>

    <nav class="side-nav side-nav-bottom" aria-label="Account and help">
      <button class="nav-item" data-page="settings" data-requires="settings.manage"><i data-lucide="settings"></i><span>Settings</span></button>
      <button class="nav-item" id="supportBtn" type="button"><i data-lucide="circle-help"></i><span>Support</span></button>
    </nav>`;

  const overlay = document.getElementById("mobileOverlay");
  const menuButton = document.getElementById("menuBtn");
  const closeButton = document.getElementById("sidebarCloseBtn");
  const mobileQuery = window.matchMedia("(max-width: 820px)");

  function syncAccessibility() {
    const isMobile = mobileQuery.matches;
    const isOpen = sidebar.classList.contains("open");
    menuButton?.setAttribute("aria-expanded", String(isMobile && isOpen));
    if (isMobile && !isOpen) {
      sidebar.setAttribute("aria-hidden", "true");
      sidebar.inert = true;
    } else {
      sidebar.removeAttribute("aria-hidden");
      sidebar.inert = false;
    }
  }

  function open() {
    if (!mobileQuery.matches) return;
    sidebar.classList.add("open");
    overlay?.classList.add("open");
    document.body.classList.add("sidebar-open");
    syncAccessibility();
    requestAnimationFrame(() => closeButton?.focus());
  }

  function close(options = {}) {
    const wasOpen = sidebar.classList.contains("open");
    sidebar.classList.remove("open");
    overlay?.classList.remove("open");
    document.body.classList.remove("sidebar-open");
    syncAccessibility();
    if (wasOpen && options.restoreFocus !== false) menuButton?.focus();
  }

  function toggle() {
    sidebar.classList.contains("open") ? close() : open();
  }

  menuButton?.addEventListener("click", toggle);
  closeButton?.addEventListener("click", () => close());
  overlay?.addEventListener("click", () => close());
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar.classList.contains("open")) close();
  });
  mobileQuery.addEventListener("change", () => {
    close({ restoreFocus: false });
    syncAccessibility();
  });

  syncAccessibility();
  window.SidebarController = { open, close, toggle };
})();
