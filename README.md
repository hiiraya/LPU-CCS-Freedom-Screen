# CCS Freedom Screen

A public coding-style terminal that lets users submit messages through code, and a TV-friendly screen that displays those entries in a scattered board layout.

# Live Product
Client : 
https://ccs-freedom-screen.appwrite.network/ 

TV Screen: https://ccs-freedom-screen.appwrite.network/wall
## Features

- **Immersive Terminal**: Write and submit messages using a code editor interface.
- **Wall Display**: View submitted messages in a dynamic, scattered layout suitable for TVs or large screens.
- **Real-time Updates**: Messages are stored and retrieved using Supabase for seamless sharing.
- **Responsive Design**: Works on various devices with a focus on terminal and wall views.

## Tech Stack

- **Frontend**: React 19, JavaScript, Vite
- **Routing**: React Router DOM
- **Backend/Database**: Supabase
- **Linting**: ESLint
- **Build Tool**: Vite

## Prerequisites

- Node.js (version 18 or higher)
- npm or yarn
- A Supabase account and project

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd ccs-freedom-screen
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Create a `.env` file in the root directory.
   - Add your Supabase URL and anon key:
     ```
     VITE_SUPABASE_URL=your-supabase-url
     VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
     ```

## Usage

### Local Development

Start the development server:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Routes

- `/` - Immersive terminal for writing code and posting entries.
- `/wall` - Read-only wall view for display screens/TVs.

### Production Build

Build the project for production:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## npm commands

- `npm run dev` - Start the development server.
- `npm run build` - Build the project for production.
- `npm run lint` - Run ESLint for code linting.
- `npm run preview` - Preview the production build locally.

## Project Structure

```
ccs-freedom-screen/
├── src/
│   ├── App.jsx          # Main app component
│   ├── main.jsx         # Entry point
│   ├── index.css        # Global styles
│   ├── pages/
│   │   ├── Terminal.jsx # Terminal page component
│   │   └── Wall.jsx     # Wall page component
│   └── utils/
│       ├── parser.js    # Utility for parsing
│       └── supabaseClient.js # Supabase client setup
├── supabase/
│   └── messages_security.sql # Supabase security setup
├── package.json
├── vite.config.js
└── README.md
```

## Supabase Setup

1. Create a new Supabase project.
2. In the Supabase dashboard, go to the SQL Editor.
3. Apply the script from [`supabase/messages_security.sql`](./supabase/messages_security.sql).

This script:
- Adds `language`, `full_code`, and `is_deleted` columns if missing.
- Enables Row Level Security on `public.messages`.
- Allows public users to `select` visible messages.
- Allows public users to `insert` new messages.
- Blocks public `update` and `delete`.
