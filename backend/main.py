from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import aiosqlite
from datetime import datetime
import uuid
import os
import json
import asyncio


app = FastAPI(title="AI Chat API")


# =========================
# CORS
# =========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# Configuration
# =========================

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "my-qwen-chat"

DATABASE = "data/chat.db"


# =========================
# Request Models
# =========================

class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    conversation_id: str
    messages: list[Message]
    regenerate: bool = False


class RenameConversationRequest(BaseModel):
    title: str


# =========================
# Database Initialization
# =========================

async def init_db():

    os.makedirs("data", exist_ok=True)

    async with aiosqlite.connect(DATABASE) as db:

        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                role TEXT,
                content TEXT,
                created_at TEXT,
                FOREIGN KEY (conversation_id)
                    REFERENCES conversations(id)
            )
        """)

        await db.commit()


@app.on_event("startup")
async def startup_event():
    await init_db()


# =========================
# Root
# =========================

@app.get("/")
def root():

    return {
        "status": "online",
        "message": "AI Chat API is running"
    }


# =========================
# Create New Conversation
# =========================

@app.post("/api/conversations")
async def create_conversation():

    conversation_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()

    async with aiosqlite.connect(DATABASE) as db:

        await db.execute(
            """
            INSERT INTO conversations
            (id, title, created_at)
            VALUES (?, ?, ?)
            """,
            (
                conversation_id,
                "New Chat",
                created_at
            )
        )

        await db.commit()

    return {
        "conversation_id": conversation_id,
        "title": "New Chat"
    }


# =========================
# Streaming Chat
# =========================

@app.post("/api/chat")
async def chat(request: ChatRequest):

    # ---------------------------------
    # Convert messages to Ollama format
    # ---------------------------------

    messages = [
        {
            "role": message.role,
            "content": message.content
        }
        for message in request.messages
    ]

    # ---------------------------------
    # Find latest user message
    # ---------------------------------

    user_messages = [
        message.content.strip()
        for message in request.messages
        if message.role == "user"
    ]

    latest_user_message = (
        user_messages[-1]
        if user_messages
        else ""
    )

    # ---------------------------------
    # Database handling
    # ---------------------------------

    async with aiosqlite.connect(DATABASE) as db:

        if request.regenerate:

            # ---------------------------------
            # REGENERATE
            # ---------------------------------
            # Do NOT insert the user message again.
            #
            # If the previous database record is
            # an assistant response, delete it.
            # The original user message remains.
            # ---------------------------------

            cursor = await db.execute(
                """
                SELECT id, role, content
                FROM messages
                WHERE conversation_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (
                    request.conversation_id,
                )
            )

            last_message = await cursor.fetchone()

            if (
                last_message
                and last_message[1] == "assistant"
            ):

                await db.execute(
                    """
                    DELETE FROM messages
                    WHERE id = ?
                    """,
                    (
                        last_message[0],
                    )
                )

        else:

            # ---------------------------------
            # NORMAL CHAT
            # ---------------------------------
            # Save the new user message.
            # ---------------------------------

            await db.execute(
                """
                INSERT INTO messages
                (conversation_id, role, content, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    request.conversation_id,
                    "user",
                    latest_user_message,
                    datetime.now().isoformat()
                )
            )

            # ---------------------------------
            # Update conversation title
            # ---------------------------------

            cursor = await db.execute(
                """
                SELECT title
                FROM conversations
                WHERE id = ?
                """,
                (
                    request.conversation_id,
                )
            )

            conversation = await cursor.fetchone()

            if (
                conversation
                and conversation[0] == "New Chat"
                and latest_user_message
            ):

                title = latest_user_message

                if len(title) > 40:
                    title = title[:40] + "..."

                await db.execute(
                    """
                    UPDATE conversations
                    SET title = ?
                    WHERE id = ?
                    """,
                    (
                        title,
                        request.conversation_id
                    )
                )

        # ---------------------------------
        # Commit database changes
        # ---------------------------------

        await db.commit()

    # ---------------------------------
    # Ollama streaming payload
    # ---------------------------------

    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "stream": True
    }

    # ---------------------------------
    # Stream response
    # ---------------------------------

    async def generate():

        assistant_response = ""

        try:

            async with httpx.AsyncClient(
                timeout=None
            ) as client:

                async with client.stream(
                    "POST",
                    OLLAMA_URL,
                    json=payload
                ) as response:

                    response.raise_for_status()

                    async for line in response.aiter_lines():

                        if not line:
                            continue

                        data = json.loads(line)

                        chunk = data.get(
                            "message",
                            {}
                        ).get(
                            "content",
                            ""
                        )

                        if chunk:

                            assistant_response += chunk

                            yield chunk

            # ---------------------------------
            # Save completed assistant response
            # ---------------------------------

            if assistant_response:

                async with aiosqlite.connect(
                    DATABASE
                ) as db:

                    await db.execute(
                        """
                        INSERT INTO messages
                        (conversation_id, role, content, created_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            request.conversation_id,
                            "assistant",
                            assistant_response,
                            datetime.now().isoformat()
                        )
                    )

                    await db.commit()

        except (
            GeneratorExit,
            asyncio.CancelledError
        ):

            # Browser stopped/disconnected.
            # Do not save incomplete response.

            print(
                "Generation stopped by client."
            )

            raise

        except Exception as error:

            print(
                "Streaming error:",
                error
            )

            raise

    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no-cache",
        }
    )


# =========================
# Rename Conversation
# =========================

@app.put(
    "/api/conversations/{conversation_id}"
)
async def rename_conversation(
    conversation_id: str,
    request: RenameConversationRequest
):

    title = request.title.strip()

    if not title:
        title = "New Chat"

    if len(title) > 60:
        title = title[:60] + "..."

    async with aiosqlite.connect(DATABASE) as db:

        await db.execute(
            """
            UPDATE conversations
            SET title = ?
            WHERE id = ?
            """,
            (
                title,
                conversation_id
            )
        )

        await db.commit()

    return {
        "success": True,
        "title": title
    }


# =========================
# Delete Conversation
# =========================

@app.delete(
    "/api/conversations/{conversation_id}"
)
async def delete_conversation(
    conversation_id: str
):

    async with aiosqlite.connect(DATABASE) as db:

        # Delete messages first
        await db.execute(
            """
            DELETE FROM messages
            WHERE conversation_id = ?
            """,
            (
                conversation_id,
            )
        )

        # Delete conversation
        await db.execute(
            """
            DELETE FROM conversations
            WHERE id = ?
            """,
            (
                conversation_id,
            )
        )

        await db.commit()

    return {
        "success": True
    }


# =========================
# Get Conversations
# =========================

@app.get("/api/conversations")
async def get_conversations():

    async with aiosqlite.connect(DATABASE) as db:

        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            """
            SELECT id, title, created_at
            FROM conversations
            ORDER BY created_at DESC
            """
        )

        rows = await cursor.fetchall()

    return [
        {
            "id": row["id"],
            "title": row["title"],
            "created_at": row["created_at"]
        }
        for row in rows
    ]


# =========================
# Get Messages
# =========================

@app.get(
    "/api/conversations/{conversation_id}/messages"
)
async def get_messages(
    conversation_id: str
):

    async with aiosqlite.connect(DATABASE) as db:

        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            """
            SELECT role, content, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            """,
            (
                conversation_id,
            )
        )

        rows = await cursor.fetchall()

    return [
        {
            "role": row["role"],
            "content": row["content"],
            "created_at": row["created_at"]
        }
        for row in rows
    ]