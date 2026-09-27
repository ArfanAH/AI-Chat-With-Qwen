# AI Chat With Qwen

A local AI chat application powered by **Qwen3.5 9B**, **Ollama**, **FastAPI**, **Next.js**, and **SQLite**.

The application runs the AI model locally on the user's computer, so conversations do not need to be sent to a third-party AI API.

## Features

- Local AI chat with Qwen3.5 9B
- English and Bangla language support
- Conversation memory
- Multiple conversations
- SQLite-based chat history
- Automatic conversation titles
- Rename conversations
- Delete conversations
- Regenerate AI responses
- Stop response generation
- Streaming AI responses
- Markdown support
- Code block rendering
- Responsive desktop and mobile interface
- Local Ollama model
- FastAPI backend
- Next.js frontend

## Architecture

```text
Next.js Frontend
       |
       v
FastAPI Backend
       |
       +----------> SQLite Database
       |
       v
     Ollama
       |
       v
  Qwen3.5 9B




Technology Stack
Frontend
Next.js
React
TypeScript
Tailwind CSS
React Markdown
remark-gfm
Backend
Python
FastAPI
Uvicorn
HTTPX
Pydantic
aiosqlite
AI
Ollama
Qwen3.5 9B GGUF
Custom Ollama model: my-qwen-chat
Database
SQLite
System Requirements

Recommended environment:

Windows 10/11
Node.js 24.x
npm 11.x
Python 3.13.x
Ollama
16 GB RAM
GPU with sufficient VRAM recommended

The application can also run without a dedicated GPU, although AI generation may be slower.


License

This project is intended for educational and personal development purposes.
Developed By Md. Arfan Ahmed