"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
};

const API_URL = "http://127.0.0.1:8000";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // =========================
  // Auto Scroll
  // =========================

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  // =========================
  // Load conversations
  // =========================

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations(openLatest = true) {
    try {
      const response = await fetch(
        `${API_URL}/api/conversations`
      );

      const data = await response.json();

      setConversations(data);

      if (openLatest && data.length > 0) {
        loadConversation(data[0].id);
      }

      if (openLatest && data.length === 0) {
        createNewChat();
      }
    } catch (error) {
      console.error(
        "Failed to load conversations:",
        error
      );
    }
  }

  // =========================
  // Create New Chat
  // =========================

  async function createNewChat() {
    if (loading) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/conversations`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      setConversationId(data.conversation_id);
      setMessages([]);

      setConversations((previous) => [
        {
          id: data.conversation_id,
          title: data.title,
          created_at: new Date().toISOString(),
        },
        ...previous,
      ]);
    } catch (error) {
      console.error(
        "Failed to create conversation:",
        error
      );
    }
  }

  // =========================
  // Load Conversation
  // =========================

  async function loadConversation(id: string) {
    if (loading) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${id}/messages`
      );

      const data = await response.json();

      setConversationId(id);

      setMessages(
        data.map(
          (message: {
            role: "user" | "assistant";
            content: string;
          }) => ({
            role: message.role,
            content: message.content,
          })
        )
      );
    } catch (error) {
      console.error(
        "Failed to load messages:",
        error
      );
    }
  }

// =========================
// Send Message
// =========================

async function sendMessage() {
  const message = input.trim();

  if (!message || loading) {
    return;
  }

  if (!conversationId) {
    return;
  }

  // Clear previous error
  setError("");

  // -------------------------
  // User message
  // -------------------------

  const userMessage: Message = {
    role: "user",
    content: message,
  };

  const updatedMessages = [
    ...messages,
    userMessage,
  ];

  setMessages([
    ...updatedMessages,
    {
      role: "assistant",
      content: "",
    },
  ]);

  setInput("");
  setLoading(true);
  setStopping(false);

  // -------------------------
  // Create abort controller
  // -------------------------

  const controller =
    new AbortController();

  abortControllerRef.current =
    controller;

  try {

    // -------------------------
    // Send request
    // -------------------------

    const response = await fetch(
      `${API_URL}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          messages: updatedMessages,
          regenerate: false,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(
        "Backend request failed"
      );
    }

    if (!response.body) {
      throw new Error(
        "Streaming response is not available"
      );
    }

    // -------------------------
    // Read stream
    // -------------------------

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let assistantResponse = "";

    while (true) {

      const {
        value,
        done,
      } = await reader.read();

      if (done) {
        break;
      }

      const chunk =
        decoder.decode(
          value,
          {
            stream: true,
          }
        );

      assistantResponse += chunk;

      // -------------------------
      // Update assistant message
      // -------------------------

      setMessages((previous) => {

        const updated = [...previous];

        updated[
          updated.length - 1
        ] = {
          role: "assistant",
          content:
            assistantResponse,
        };

        return updated;
      });
    }

    // -------------------------
    // Refresh sidebar
    // -------------------------

    await loadConversations(false);

  } catch (error) {

    // -------------------------
    // User stopped generation
    // -------------------------

    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {

      console.log(
        "Generation stopped."
      );

    } else {

      console.error(
        "Chat error:",
        error
      );

      setError(
        "Sorry, something went wrong. Please check that the backend and Ollama are running."
      );

      // Remove empty assistant message
      setMessages((previous) => {

        const updated = [...previous];

        if (
          updated.length > 0 &&
          updated[updated.length - 1].role ===
            "assistant" &&
          !updated[updated.length - 1].content
        ) {
          updated.pop();
        }

        return updated;
      });
    }

  } finally {

    abortControllerRef.current =
      null;

    setLoading(false);
    setStopping(false);
  }
}


// =========================
// Stop Generating
// =========================

function stopGenerating() {

  if (!loading) {
    return;
  }

  setStopping(true);

  abortControllerRef.current?.abort();
}


// =========================
// Regenerate Response
// =========================

async function regenerateResponse() {
  if (
    loading ||
    regenerating ||
    !conversationId ||
    messages.length === 0
  ) {
    return;
  }

  // Clear previous error
  setError("");

  // -------------------------
  // Find last user message
  // -------------------------

  let lastUserIndex = -1;

  for (
    let i = messages.length - 1;
    i >= 0;
    i--
  ) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return;
  }

  const messagesForAI =
    messages.slice(0, lastUserIndex + 1);

  // -------------------------
  // Remove current assistant response
  // -------------------------

  setMessages(messagesForAI);

  setLoading(true);
  setRegenerating(true);
  setStopping(false);

  const controller =
    new AbortController();

  abortControllerRef.current =
    controller;

  try {

    // -------------------------
    // Send regenerate request
    // -------------------------

    const response = await fetch(
      `${API_URL}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          messages: messagesForAI,
          regenerate: true,
        }),
        signal:
          controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(
        "Backend request failed"
      );
    }

    if (!response.body) {
      throw new Error(
        "Streaming response is not available"
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let assistantResponse = "";

    // -------------------------
    // Add empty assistant message
    // -------------------------

    setMessages([
      ...messagesForAI,
      {
        role: "assistant",
        content: "",
      },
    ]);

    // -------------------------
    // Read stream
    // -------------------------

    while (true) {

      const {
        value,
        done,
      } = await reader.read();

      if (done) {
        break;
      }

      const chunk =
        decoder.decode(
          value,
          {
            stream: true,
          }
        );

      assistantResponse += chunk;

      setMessages((previous) => {

        const updated = [...previous];

        updated[
          updated.length - 1
        ] = {
          role: "assistant",
          content:
            assistantResponse,
        };

        return updated;
      });
    }

    // -------------------------
    // Refresh sidebar
    // -------------------------

    await loadConversations(false);

  } catch (error) {

    // -------------------------
    // User stopped regeneration
    // -------------------------

    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {

      console.log(
        "Regeneration stopped."
      );

    } else {

      console.error(
        "Regeneration error:",
        error
      );

      setError(
        "Sorry, something went wrong while regenerating the response."
      );

      // Remove empty assistant message
      setMessages((previous) => {

        const updated = [...previous];

        if (
          updated.length > 0 &&
          updated[updated.length - 1].role ===
            "assistant" &&
          !updated[updated.length - 1].content
        ) {
          updated.pop();
        }

        return updated;
      });
    }

  } finally {

    abortControllerRef.current =
      null;

    setLoading(false);
    setStopping(false);
    setRegenerating(false);
  }
}


    // =========================
  // Rename Conversation
  // =========================

  async function renameConversation(
    id: string,
    currentTitle: string
  ) {
    const newTitle = window.prompt(
      "Enter new chat name:",
      currentTitle
    );

    if (
      newTitle === null ||
      !newTitle.trim()
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: newTitle.trim(),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Rename failed"
        );
      }

      const data = await response.json();

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                title: data.title,
              }
            : conversation
        )
      );

    } catch (error) {
      console.error(
        "Rename error:",
        error
      );
    }
  }


  // =========================
  // Delete Conversation
  // =========================

  async function deleteConversation(
    id: string
  ) {

    const confirmed =
      window.confirm(
        "Delete this conversation?\n\nThis cannot be undone."
      );

    if (!confirmed) {
      return;
    }

    try {

      const response = await fetch(
        `${API_URL}/api/conversations/${id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Delete failed"
        );
      }

      const remaining =
        conversations.filter(
          (conversation) =>
            conversation.id !== id
        );

      setConversations(remaining);

      // -------------------------
      // If current chat deleted
      // -------------------------

      if (conversationId === id) {

        if (remaining.length > 0) {

          await loadConversation(
            remaining[0].id
          );

        } else {

          await createNewChat();

        }

      }

    } catch (error) {

      console.error(
        "Delete error:",
        error
      );

    }
  }

  // =========================
  // Enter Key
  // =========================

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      sendMessage();
    }
  }

  // =========================
// UI
// =========================

return (
  <main className="flex h-screen overflow-hidden bg-gray-100 text-gray-900">

    {/* ================= MOBILE OVERLAY ================= */}

    {sidebarOpen && (
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={() => setSidebarOpen(false)}
      />
    )}


    {/* ================= SIDEBAR ================= */}

    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-gray-300 transition-transform duration-200 md:static md:z-auto md:w-64 md:translate-x-0 ${
        sidebarOpen
          ? "translate-x-0"
          : "-translate-x-full"
      }`}
    >

      {/* Sidebar Header */}

      <div className="border-b border-gray-400 px-4 py-4">

        <div className="mb-4 flex items-center justify-between">

          <div className="flex min-w-0 items-center gap-2">

            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-gray-900 shadow-sm">
              AI
            </div>

            <div className="min-w-0">

              <h2 className="truncate text-sm font-semibold text-gray-900">
                Chat With Me
              </h2>

              <p className="text-xs text-gray-600">
                Local Assistant
              </p>

            </div>

          </div>


          {/* Mobile Close */}

          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-400 hover:text-gray-900 md:hidden"
            title="Close sidebar"
          >
            ×
          </button>

        </div>


        {/* New Chat */}

        <button
          onClick={() => {
            createNewChat();
            setSidebarOpen(false);
          }}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >

          <span className="text-lg leading-none">
            +
          </span>

          <span>
            New Chat
          </span>

        </button>

      </div>


      {/* ================= CONVERSATION LIST ================= */}

      <div className="flex-1 overflow-y-auto px-2 py-3">

        {conversations.length === 0 ? (

          <div className="px-3 py-6 text-center text-xs text-gray-600">
            No conversations yet
          </div>

        ) : (

          <>

            <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-gray-600">
              Recent Chats
            </div>


            {conversations.map(
              (conversation) => (

                <div
                  key={conversation.id}
                  className={`group mb-1 flex min-w-0 items-center rounded-lg transition ${
                    conversation.id === conversationId
                      ? "bg-gray-800"
                      : "hover:bg-gray-400"
                  }`}
                >

                  {/* Chat Title */}

                  <button
                    onClick={() => {
                      loadConversation(
                        conversation.id
                      );
                      setSidebarOpen(false);
                    }}
                    disabled={loading}
                    className={`min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed ${
                      conversation.id === conversationId
                        ? "text-white"
                        : "text-gray-800 group-hover:text-gray-950"
                    }`}
                  >
                    {conversation.title}
                  </button>


{/* Actions */}

{!loading && (

  <div className="mr-1 flex shrink-0 items-center gap-0.5">

    {/* Rename */}

    <button
      onClick={() => {
        renameConversation(
          conversation.id,
          conversation.title
        );
        setSidebarOpen(false);
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition md:h-7 md:w-7 ${
        conversation.id === conversationId
          ? "text-gray-300 hover:bg-gray-700 hover:text-white"
          : "text-gray-500 hover:bg-gray-400 hover:text-gray-900"
      }`}
      title="Rename"
    >
      <span className="text-sm">
        ✎
      </span>
    </button>


    {/* Delete */}

    <button
      onClick={() => {
        deleteConversation(
          conversation.id
        );
        setSidebarOpen(false);
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition md:h-7 md:w-7 ${
        conversation.id === conversationId
          ? "text-gray-300 hover:bg-red-900/40 hover:text-red-300"
          : "text-gray-500 hover:bg-red-100 hover:text-red-600"
      }`}
      title="Delete"
    >
      <span className="text-base leading-none">
        ×
      </span>
    </button>

  </div>

)}

                </div>

              )
            )}

          </>

        )}

      </div>


      {/* ================= MODEL INFO ================= */}

      <div className="border-t border-gray-400 p-4">

        <div className="flex items-center gap-3">

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-800">
            <span className="h-2 w-2 rounded-full bg-green-500" />
          </div>

          <div className="min-w-0">

            <p className="text-xs font-medium text-gray-700">
              AI Runs locally with
            </p>

            <p className="truncate text-xs text-gray-600">
              Qwen 3.5 9B
            </p>

          </div>

        </div>

      </div>

    </aside>


    {/* ================= MAIN CHAT ================= */}

    <section className="flex min-w-0 flex-1 flex-col">


      {/* ================= HEADER ================= */}

      <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">

        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">


          {/* Mobile Menu Button + Title */}

          <div className="flex min-w-0 items-center gap-3">

            <button
              onClick={() =>
                setSidebarOpen(true)
              }
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-700 transition hover:bg-gray-100 md:hidden"
              title="Open sidebar"
            >
              <span className="text-lg leading-none">
                ☰
              </span>
            </button>


            <div className="min-w-0">

              <h1 className="truncate text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Chat With Me
              </h1>

              <div className="mt-0.5 flex items-center gap-2 sm:mt-1">

                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />

                <p className="truncate text-xs text-gray-500 sm:text-sm">
                  Qwen 3.5 9B
                </p>

              </div>

            </div>

          </div>


          {/* Developer Info */}

          <div className="hidden shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 sm:block">

            <span className="text-xs font-medium text-gray-600">
              Local AI Developed by Md. Arfan Ahmed
            </span>

          </div>


          {/* Mobile Developer Info */}

          <div className="max-w-[150px] shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 sm:hidden">

            <span className="block truncate text-[10px] font-medium text-gray-600">
              Local AI • Arfan Ahmed
            </span>

          </div>

        </div>

      </header>


      {/* ================= MESSAGES ================= */}

      <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-5 sm:px-6 sm:py-6">

        <div className="mx-auto max-w-4xl space-y-5 sm:space-y-7">



          {error && (
  <div className="mx-auto mb-4 w-full max-w-4xl px-1">
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span className="mt-0.5 shrink-0">⚠</span>

      <p className="flex-1 leading-5">
        {error}
      </p>

      <button
        onClick={() => setError("")}
        className="shrink-0 text-red-500 transition hover:text-red-700"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  </div>
)}


          {/* ================= EMPTY CHAT ================= */}

          {messages.length === 0 && (

            <div className="flex min-h-[55vh] items-center justify-center px-2 sm:min-h-[60vh]">

              <div className="w-full max-w-xl text-center">

                <div className="mx-auto mb-5 flex h-14 w-36 items-center justify-center rounded-2xl bg-gray-900 text-base font-bold text-white shadow-sm sm:h-16 sm:w-40 sm:text-lg">
                  Chat With Me
                </div>

                <h2 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                  How can I help you?
                </h2>

                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">
                  Ask anything and chat naturally with your local AI assistant.
                </p>


                {/* Suggestion Cards */}

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">

                  <div className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md">

                    <p className="text-sm font-medium text-gray-800">
                      💡 Ask a question
                    </p>

                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Get explanations, ideas, or answers to your questions.
                    </p>

                  </div>


                  <div className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md">

                    <p className="text-sm font-medium text-gray-800">
                      💻 Write code
                    </p>

                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Ask for programming help, debugging, or examples.
                    </p>

                  </div>

                </div>

              </div>

            </div>

          )}


          {/* ================= MESSAGES LIST ================= */}

          {messages.map(
            (message, index) => (

              <div
                key={index}
                className={`flex w-full ${
                  message.role === "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >

                <div
                  className={`flex max-w-[95%] gap-2.5 sm:max-w-[85%] sm:gap-3 ${
                    message.role === "user"
                      ? "flex-row-reverse"
                      : "flex-row"
                  }`}
                >


                  {/* Avatar */}

                  <div
                    className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold sm:text-xs ${
                      message.role === "user"
                        ? "bg-gray-800 text-white"
                        : "border border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    {message.role === "user"
                      ? "You"
                      : "AI"}
                  </div>


                  {/* Message Content */}

                  <div
                    className={`min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 text-sm sm:px-4 sm:py-3 sm:text-base ${
                      message.role === "user"
                        ? "bg-gray-900 text-white shadow-sm"
                        : "border border-gray-200 bg-white text-gray-900 shadow-sm"
                    }`}
                  >


                    {/* ================= THINKING ================= */}

                    {message.content === "" &&
                    message.role === "assistant" &&
                    loading ? (

                      <div className="flex items-center gap-1.5 px-1 py-0.5 text-sm text-gray-500">

                        <span>
                          Thinking
                        </span>

                        <span className="animate-bounce">
                          .
                        </span>

                        <span
                          className="animate-bounce"
                          style={{
                            animationDelay:
                              "0.15s",
                          }}
                        >
                          .
                        </span>

                        <span
                          className="animate-bounce"
                          style={{
                            animationDelay:
                              "0.3s",
                          }}
                        >
                          .
                        </span>

                      </div>

                    ) : message.role === "assistant" ? (


                      /* ================= MARKDOWN ================= */

                      <div className="prose prose-sm max-w-none break-words">

                        <ReactMarkdown
                          remarkPlugins={[
                            remarkGfm,
                          ]}
                          components={{

                            h1: ({
                              children,
                            }) => (
                              <h1 className="mb-3 mt-2 text-xl font-bold tracking-tight sm:text-2xl">
                                {children}
                              </h1>
                            ),

                            h2: ({
                              children,
                            }) => (
                              <h2 className="mb-2 mt-5 text-lg font-bold tracking-tight sm:text-xl">
                                {children}
                              </h2>
                            ),

                            h3: ({
                              children,
                            }) => (
                              <h3 className="mb-2 mt-4 text-base font-semibold sm:text-lg">
                                {children}
                              </h3>
                            ),

                            p: ({
                              children,
                            }) => (
                              <p className="mb-3 break-words leading-7 last:mb-0">
                                {children}
                              </p>
                            ),

                            ul: ({
                              children,
                            }) => (
                              <ul className="mb-3 list-disc space-y-1.5 pl-5 sm:pl-6">
                                {children}
                              </ul>
                            ),

                            ol: ({
                              children,
                            }) => (
                              <ol className="mb-3 list-decimal space-y-1.5 pl-5 sm:pl-6">
                                {children}
                              </ol>
                            ),

                            li: ({
                              children,
                            }) => (
                              <li className="leading-6">
                                {children}
                              </li>
                            ),

                            blockquote: ({
                              children,
                            }) => (
                              <blockquote className="my-4 border-l-4 border-gray-300 pl-3 italic text-gray-600 sm:pl-4">
                                {children}
                              </blockquote>
                            ),


                            /* Code */

                            code: ({
                              children,
                              className,
                            }) => {

                              const isBlock =
                                className?.includes(
                                  "language-"
                                );

                              if (isBlock) {

                                return (
                                  <pre className="my-4 max-w-full overflow-x-auto rounded-xl bg-gray-950 p-3 text-xs leading-6 text-gray-100 shadow-inner sm:p-4 sm:text-sm">
                                    <code>
                                      {children}
                                    </code>
                                  </pre>
                                );

                              }

                              return (
                                <code className="break-words rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-800 sm:text-sm">
                                  {children}
                                </code>
                              );

                            },


                            /* Table */

                            table: ({
                              children,
                            }) => (
                              <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-gray-200">
                                <table className="w-full min-w-[500px] border-collapse text-xs sm:text-sm">
                                  {children}
                                </table>
                              </div>
                            ),

                            th: ({
                              children,
                            }) => (
                              <th className="border-b border-gray-200 bg-gray-50 px-3 py-2.5 text-left font-semibold">
                                {children}
                              </th>
                            ),

                            td: ({
                              children,
                            }) => (
                              <td className="border-b border-gray-100 px-3 py-2.5">
                                {children}
                              </td>
                            ),


                            /* Links */

                            a: ({
                              children,
                              href,
                            }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium underline underline-offset-2 hover:opacity-70"
                              >
                                {children}
                              </a>
                            ),

                          }}
                        >
                          {message.content}
                        </ReactMarkdown>


                        {/* ================= REGENERATE ================= */}

                        {message.role === "assistant" &&
                        message.content &&
                        !loading &&
                        index === messages.length - 1 && (

                          <div className="mt-3 border-t border-gray-100 pt-2">

                            <button
                              onClick={
                                regenerateResponse
                              }
                              disabled={
                                regenerating
                              }
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >

                              <span className="text-sm">
                                ↻
                              </span>

                              <span>
                                Regenerate
                              </span>

                            </button>

                          </div>

                        )}

                      </div>

                    ) : (


                      /* ================= USER MESSAGE ================= */

                      <div className="whitespace-pre-wrap break-words leading-6">
                        {message.content}
                      </div>

                    )}

                  </div>

                </div>

              </div>

            )
          )}


          {/* ================= AUTO SCROLL ================= */}

          <div ref={messagesEndRef} />

        </div>

      </div>


      {/* ================= INPUT ================= */}

      <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-3 sm:px-4 sm:py-4">

        <div className="mx-auto max-w-4xl">

          <div className="flex items-end gap-2 rounded-2xl border border-gray-300 bg-gray-50 p-1.5 shadow-sm focus-within:border-gray-500 focus-within:bg-white sm:gap-3 sm:p-2">


            {/* Textarea */}

            <textarea
              value={input}
              onChange={(event) =>
                setInput(event.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="Message your AI..."
              rows={1}
              disabled={loading}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed disabled:text-gray-400 sm:min-h-11 sm:px-3"
            />


            {/* Send / Stop */}

            <button
              onClick={
                loading
                  ? stopGenerating
                  : sendMessage
              }
              disabled={
                stopping ||
                (!loading &&
                  !input.trim())
              }
              className={`flex h-10 shrink-0 items-center justify-center rounded-xl px-3.5 text-sm font-medium transition sm:h-11 sm:px-5 ${
                loading
                  ? "bg-gray-800 text-white hover:bg-gray-700"
                  : "bg-gray-900 text-white hover:bg-gray-800"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >

              {loading ? (

                stopping ? (

                  <span className="flex items-center gap-1.5">

                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-400 border-t-white" />

                    <span className="hidden sm:inline">
                      Stopping
                    </span>

                  </span>

                ) : (

                  <span className="flex items-center gap-1.5">

                    <span className="h-2 w-2 rounded-full bg-red-400" />

                    <span>
                      Stop
                    </span>

                  </span>

                )

              ) : (

                <span className="flex items-center gap-1.5">

                  <span>
                    Send
                  </span>

                  <span className="text-base">
                    ↑
                  </span>

                </span>

              )}

            </button>

          </div>


          {/* Footer */}

          <p className="mt-2 text-center text-[10px] text-gray-400 sm:text-[11px]">
            Local AI • Conversations are stored locally
          </p>

        </div>

      </div>

    </section>

  </main>
);
}