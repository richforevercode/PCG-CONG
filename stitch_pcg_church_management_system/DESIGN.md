---
name: Ecclesia Heritage
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#444653'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#747684'
  outline-variant: '#c4c5d5'
  surface-tint: '#3557bc'
  primary: '#002068'
  on-primary: '#ffffff'
  primary-container: '#003399'
  on-primary-container: '#8aa4ff'
  inverse-primary: '#b5c4ff'
  secondary: '#bc000c'
  on-secondary: '#ffffff'
  secondary-container: '#e80f16'
  on-secondary-container: '#fffbff'
  tertiary: '#002f06'
  on-tertiary: '#ffffff'
  tertiary-container: '#00480e'
  on-tertiary-container: '#74b86e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b5c4ff'
  on-primary-fixed: '#00164e'
  on-primary-fixed-variant: '#153ea3'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffb4aa'
  on-secondary-fixed: '#410001'
  on-secondary-fixed-variant: '#930007'
  tertiary-fixed: '#acf4a4'
  tertiary-fixed-dim: '#91d78a'
  on-tertiary-fixed: '#002203'
  on-tertiary-fixed-variant: '#0c5216'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-lg:
    fontFamily: Source Serif 4
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Source Serif 4
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Source Serif 4
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Source Serif 4
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  container-max-width: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
  sidebar-width: 280px
---

## Brand & Style

This design system is built for the Presbyterian Church of Ghana, focusing on **dignity, stewardship, and community**. The brand personality is rooted in a "Modern Traditionalist" aesthetic—balancing the historical weight of the Church with the efficiency of modern administrative tools.

The visual style follows a **Corporate/Modern** movement with high-contrast editorial touches. It prioritizes clarity and institutional trust, utilizing a structured layout that feels architectural and stable. The target audience includes church administrators, clergy, and lay leaders who require a reliable, professional environment to manage sacred and community resources.

- **Trustworthy:** Through the use of deep royal blues and stable serif headings.
- **Modern:** Through generous whitespace, clean UI fonts, and a systematic grid.
- **Organized:** Through clear information hierarchy and consistent component logic.

## Colors

The palette is derived directly from the Church's crest, symbolizing heritage and identity.

- **Primary (Royal Blue):** Used for primary actions, navigation backgrounds, and brand-heavy elements. It conveys authority and stability.
- **Secondary (Vibrant Red):** Used sparingly for high-impact alerts, specific call-to-actions, or iconography representing the Holy Spirit or institutional vigor.
- **Tertiary (Palm Green):** Derived from the palm tree in the crest, used for "Success" states, financial growth indicators, and agricultural/missionary initiatives.
- **Neutral:** A range of clean greys and off-whites to ensure the interface feels airy and professional, preventing the vibrant primary colors from overwhelming the user during long administrative sessions.

## Typography

This design system uses a hybrid typographic approach. **Source Serif 4** is utilized for headlines to evoke the literary and historical tradition of the Presbyterian Church, providing an authoritative and scholarly feel. **Hanken Grotesk** is used for all UI elements, body text, and data inputs to ensure maximum legibility and a contemporary feel in a complex management environment.

- **Serif for Narrative:** Use for page titles, section headers, and traditional quotes or scripture.
- **Sans-Serif for Utility:** Use for all labels, navigation links, data tables, and form fields.

## Layout & Spacing

The system employs a **Fixed Grid** for desktop content areas to maintain readability of long-form reports and data, and a **Fluid Grid** for dashboard views.

- **The 8px Rhythm:** All spacing and sizing must be multiples of 8px (8, 16, 24, 32, 48, 64).
- **Dashboard Layout:** Utilizes a persistent left sidebar (280px) for high-level navigation, with a top utility bar for global search and profile management.
- **Breakpoints:**
  - **Mobile (<600px):** Single column, 16px margins, bottom navigation or "hamburger" menu.
  - **Tablet (600px - 1024px):** 2-column layout for cards, 24px margins.
  - **Desktop (>1024px):** Full 12-column grid, sidebar visible, 32px margins.

## Elevation & Depth

To maintain a professional and clean appearance, this design system uses **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows.

- **Surface Levels:** 
  - Level 0 (Background): #F8F9FA.
  - Level 1 (Cards/Container): #FFFFFF with a 1px border (#E9ECEF).
  - Level 2 (Active/Hover): Subtle ambient shadow (0px 4px 12px rgba(0, 51, 153, 0.05)).
- **Interactions:** Elevation is used sparingly to indicate "lift" on interactive cards or to separate modal windows from the backdrop. 
- **Dividers:** Use thin 1px lines in #E9ECEF to separate list items and table rows, ensuring the UI remains light and structured.

## Shapes

The shape language is **Soft (0.25rem)**. This subtle rounding removes the harshness of sharp corners while maintaining the structured, institutional feel required for a Church Management System.

- **Buttons & Inputs:** 4px (0.25rem) corner radius.
- **Cards & Modals:** 8px (0.5rem) corner radius.
- **Data Highlight:** 2px radius for table row selections to keep the grid feeling "tight."

## Components

### Navigation
- **Sidebar:** Primary Blue (#003399) background with white text. Active states should use a subtle white overlay (10% opacity) and a 4px red accent bar on the left edge.
- **Breadcrumbs:** Use `label-md` in medium grey to help users navigate deep administrative hierarchies.

### Data Tables
- **Header:** Light grey background (#F1F3F5), `label-sm` (bold/uppercase) for column titles.
- **Rows:** 1px bottom border. Hover state should be a very light tint of the primary color (#F0F4FF).
- **Cells:** Use `body-md` for standard data, `label-md` (monospace-adjacent) for numerical values.

### Cards
- White background, 1px border in #E9ECEF.
- Headers should use `title-lg` (Sans-Serif) for utility-based cards and `headline-md` (Serif) for narrative/summary cards.

### Buttons
- **Primary:** Solid #003399 with white text.
- **Secondary:** Outlined 1px #003399 with blue text.
- **Destructive:** Solid #E30613 for critical actions (e.g., deleting records).

### Input Fields
- White background with a 1px #CED4DA border. On focus, the border shifts to Primary Blue with a 2px outer glow of 10% opacity blue.