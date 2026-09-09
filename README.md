# TaskGram

A simple, lightweight task manager built to look and feel like Telegram. 

TaskGram lets you organize your tasks across multiple profiles and lists, pin important items, and manage your to-dos with a familiar chat-like interface. It runs completely in the browser with zero dependencies.

## Features

- **Telegram-style Interface**: A clean layout inspired by Telegram, with sidebar lists, chat-style task view, and dark mode vibes.
- **Multiple Profiles**: Switch between different profiles (like Personal, Work, or Projects) to keep your tasks separate.
- **Custom Lists**: Create lists with custom colors to group your tasks.
- **Pinning**: Pin key lists to the top of your sidebar, or pin high-priority tasks to the top of a list.
- **Multi-Select & Bulk Actions**: Select multiple tasks at once to complete or delete them together.
- **Search**: Quickly search through your lists and tasks.
- **Auto-Save**: Everything saves automatically to your browser (`localStorage`).
- **No Setup Needed**: Pure HTML, CSS, and JS. No `npm install`, no build tools, no framework overhead.

## Quick Start

Just open `index.html` in your browser.

If you prefer running a local server:
```bash
# Python
python -m http.server 8000

# Node / npx
npx serve
```
Then visit `http://localhost:8000` (or whichever port is shown).

## Project Structure

- `index.html` – Page markup and modal overlays.
- `style.css` – "Midnight Glass" design system (tokens, layout, motion), responsive rules, and accessibility support.
- `script.js` – App logic, state management, and local storage sync.

## How to Use

1. **Profiles**: Click the menu icon (top-left) to switch or create profiles.
2. **Lists**: Click **+ New list** at the bottom of the sidebar to start a new list.
3. **Tasks**: Type your task into the bottom input field and hit Enter.
4. **Context Menu**: Right-click any task or list for options like Pin, Edit, or Delete.
5. **Bulk Actions**: Click or long-press tasks to select multiple items at once.

