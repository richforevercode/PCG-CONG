# Resurrection Congregation Management System

A responsive church administration dashboard for the Presbyterian Church of Ghana, Resurrection Congregation. It uses plain HTML, CSS, JavaScript, and Supabase authentication and data services.

## Run locally

For the most reliable authentication experience, serve the folder with a local web server:

```powershell
npx serve .
```

Open `signin.html` and sign in with an active administrator account. Unauthenticated visits to `index.html` are redirected to the sign-in page.

Members use the separate `member-signin.html` entry point. Their accounts are routed only to `member-portal.html`; administrator accounts remain in the management application.

## Connect Supabase

1. Create and link a Supabase project.
2. Add the project URL and publishable key to `config.js`.
3. Apply every versioned database migration with `npx supabase db push`.
4. Deploy the protected account function with `npx supabase functions deploy manage-users`.
5. Create the first Auth user in **Authentication > Users** before applying the role migration. Existing Auth users are promoted to **Super Administrator** when the migration runs.
6. Open `signin.html` and sign in. Additional accounts and custom roles can then be managed from **Users & roles**.

To register a portal member, first create or select their record in **Membership**, then create an account in **Users & roles**, choose the protected **Member** role, and link that account to the matching member record. A member record can be linked to only one login.

The included Row Level Security policies check each active user's assigned role and permissions. User creation runs inside a Supabase Edge Function; never put a Supabase secret or `service_role` key in browser code.

## Features

- Responsive dashboard with attendance, giving, activity, and programme summaries
- Church service attendance statistics for adults, Junior Youth, children, gender, and visitors with automatically calculated totals
- Daily, weekly, monthly, category, and occasion attendance growth reports with increase/decrease indicators
- Searchable member directory with add, edit, delete, filter, and CSV export
- Configurable age- and gender-based generational groups with automatic member classification
- Database-backed Presbyterian finance module with member-linked Tithes and Voluntary Thanks Offering (VTO), Sunday-through-Saturday Day Born Mini-Harvest and separate Main Harvest tracking with distinct Actual Collection, Pledge, Pledge Redeemed, and derived Outstanding Pledge metrics, automatic service totals, giving history on authorized member profiles, offertory, expenses, funds, filtered reports, and audit history
- Dedicated Communion module with separate Communion occasions and registers, adult communicant eligibility, eligible visitor/non-member participation, database-enforced Children Service and Junior Youth (JY) exclusions, occasion statistics and trends, and explicit Communion history on authorized member profiles
- Configurable distribution for Tithe, Adult Offertory, Children Service Offertory, and Junior Youth (JY) Offertory with historical calculation snapshots and concurrency-safe Sebrepor District remittance tracking; Mini-Harvest and all other income remain 100% local
- Daily, weekly, monthly, quarterly, yearly, collection-type, and comparable-period financial growth analytics
- Event calendar and programme scheduling
- Printable membership and stewardship reports
- Dedicated responsive sign-in screen and authenticated route guard
- Administrator creation, activation, role allocation, and password reset
- Built-in and custom roles with granular access permissions
- Permission-aware navigation and Supabase Row Level Security
- Separate mobile-friendly Member Portal for personal profile, giving, pledges, Communion, individual attendance, targeted events, announcements, fellowship information, and account settings
- Database-enforced one-account-to-one-member linkage and own-record-only RLS policies
- Administrator workflows for targeted announcements and member-submitted profile correction requests

## Project files

- `member-signin.html` and `components/member-signin.*` — dedicated Member Portal authentication
- `member-portal.html` and `components/member-portal.*` — private member experience and personal record views
- `components/announcements.js` and `components/member-profile-requests.js` — administrator publishing and profile-request review workflows

- `index.html` — application structure
- `styles.css` — responsive design system and components
- `components/sidebar.js` — isolated sidebar markup and drawer behavior
- `components/sidebar.css` — sidebar layout, scrolling, and responsive states
- `components/dashboard.css` — dashboard grid, insights, and responsive presentation
- `components/profile.js` — authenticated administrator profile and account actions
- `components/profile.css` — responsive profile trigger and account menu
- `components/signin.js` and `components/signin.css` — secure sign-in experience
- `components/user-management.js` and `components/user-management.css` — users, roles, and permissions UI
- `components/generational-groups.js` and `components/generational-groups.css` — rule administration, age calculation, and classification UI
- `components/attendance.js` and `components/attendance.css` — service-statistics register, calculated totals, history, filters, reports, and growth visualizations
- `components/finance.js` and `components/finance.css` — finance dashboard, collection workflows, growth chart, expenses, funds, remittances, reports, settings, and audit UI
- `app.js` — application behavior and data integration
- `config.js` — public Supabase configuration
- `supabase-schema.sql` — foundation tables for reference
- `supabase/migrations/` — complete versioned schema and Row Level Security
- `supabase/functions/manage-users/` — protected account-management function
- `stitch_pcg_church_management_system/` — original supplied UI reference
