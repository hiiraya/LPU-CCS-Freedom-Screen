# CCS Freedom Screen

CCS Freedom Screen is a coding-themed message wall built for public display. Users submit a message by writing code in a browser-based IDE, and the output appears on a live wall designed for TVs, projectors, and shared spaces.

## Live Routes

- Client: <https://ccs-freedom-screen.appwrite.network/>
- Wall: <https://ccs-freedom-screen.appwrite.network/wall>

## What It Does

- Presents a VS Code-inspired editor for writing and submitting messages as code.
- Detects the active language automatically and validates program shape before posting.
- Converts printed output into wall entries stored in Supabase.
- Shows entries on a realtime wall with pan, zoom, minimap, and placement persistence.
- Includes admin tools for CSV export, single-entry deletion, and clearing the wall.

## Supported Languages

- Python
- JavaScript
- Java
- C++
- C#

## Stack

- React 19
- Vite
- React Router DOM
- Supabase
- ESLint
- `three`, `ogl`, and `postprocessing` for visual effects

## Project Routes

- `/` - Interactive IDE submission screen
- `/wall` - Live wall display with admin and viewer controls

## Local Setup

### Prerequisites

- Node.js 18+
- npm
- A Supabase project

### Install

```bash
git clone <repository-url>
cd CCS-Freedom-Screen
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

The app throws an error on startup if either variable is missing.

## Run The App

```bash
npm run dev
```

Open <http://localhost:5173>.

### Available Scripts

- `npm run dev` - Start the Vite dev server
- `npm run build` - Create a production build
- `npm run preview` - Preview the production build locally
- `npm run lint` - Run ESLint

## Supabase Setup

Run [`supabase/messages_security.sql`](./supabase/messages_security.sql) in the Supabase SQL Editor.

That script:

- adds wall-related columns if they do not already exist
- enables row-level security on `public.messages`
- allows public reads of visible entries
- allows public inserts for valid entries
- blocks public updates and deletes
- installs RPC functions for admin login and admin delete actions
- enables realtime publication for the `messages` table

## Important Admin Note

The SQL script seeds `public.admin_settings` with a placeholder password:

```text
Enter_Admin_Password
```

Before using admin tools in `/wall`, update that value in Supabase to a real password hash or change the placeholder in the SQL script before running it in production.

## Behavior Notes

- Only printed output is posted to the wall.
- The IDE enforces a visible output requirement before submission.
- The wall uses realtime updates when available and falls back to polling if realtime disconnects.
- Message inserts and reads use schema fallbacks so the app can still work against older table versions.

## Project Structure

```text
CCS-Freedom-Screen/
|-- src/
|   |-- App.jsx
|   |-- main.jsx
|   |-- index.css
|   |-- pages/
|   |   |-- Terminal.jsx
|   |   `-- Wall.jsx
|   |-- components/
|   |   |-- LanguageIcon.jsx
|   |   |-- PixelBlast.jsx
|   |   `-- WallBackground.jsx
|   `-- utils/
|       |-- documentHead.js
|       |-- languages.js
|       |-- messagePlacement.js
|       |-- messagesApi.js
|       |-- parser.js
|       `-- supabaseClient.js
|-- supabase/
|   `-- messages_security.sql
|-- package.json
|-- vite.config.js
`-- README.md
```

## Status

This repository is currently focused on the live browser experience and Supabase-backed wall workflow. The `OLD_CODE/` folder is retained as archive/reference material and is not part of the active app.
