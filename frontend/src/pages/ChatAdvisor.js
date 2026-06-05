import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from '../api';

const fmt = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// Render plain text preserving line breaks and basic markdown-lite
function MessageText({ text }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
      {text.split('\n').map((line, i) => {
        // Bold: **text**
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <span key={i}>
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={j}>{p.slice(2, -2)}</strong>
                : p
            )}
            {i < text.split('\n').length - 1 && <br />}
          </span>
        );
      })}
    </div>
  );
}

function ActionCard({ action, onConfirm, onDismiss }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/chat/execute', { action });
      setDone({ ok: true, msg: res.data.message });
      onConfirm && onConfirm(res.data);
    } catch (e) {
      setDone({ ok: false, msg: e.response?.data?.detail || 'Something went wrong' });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div style={styles.actionCard}>
        <span style={{ color: done.ok ? '#34c759' : '#ff3b30', fontWeight: 600 }}>
          {done.ok ? '✅ ' : '❌ '}{done.msg}
        </span>
      </div>
    );
  }

  return (
    <div style={styles.actionCard}>
      <div style={styles.actionPrompt}>{action.prompt}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={handleConfirm}
          disabled={loading}
          style={styles.confirmBtn}
        >
          {loading ? '…' : '✓ Confirm'}
        </button>
        <button onClick={onDismiss} disabled={loading} style={styles.cancelBtn}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px' }}>
      <div style={styles.avatarSmall}>🤖</div>
      <div style={styles.typingDots}>
        <span style={{ ...styles.dot, animationDelay: '0ms' }} />
        <span style={{ ...styles.dot, animationDelay: '160ms' }} />
        <span style={{ ...styles.dot, animationDelay: '320ms' }} />
      </div>
    </div>
  );
}

export default function ChatAdvisor() {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingActions, setPendingActions] = useState({}); // messageIndex → action
  const [unavailable, setUnavailable] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Check availability first
    axios.get('/api/chat/status').then((res) => {
      if (!res.data.available) {
        setUnavailable(true);
        return;
      }
      setHistory([{
        role: 'assistant',
        content: "Hi! I'm your AI financial advisor. I have access to your real financial data and I'm here to help you understand your finances, set goals, and make smarter money decisions.\n\nYou can tell me about expenses you've had, ask how your spending looks, set a budget goal, or just ask for advice. What's on your mind?",
      }]);
    }).catch(() => {
      // If status check fails, still attempt to load chat
      setHistory([{
        role: 'assistant',
        content: "Hi! I'm your AI financial advisor. What's on your mind?",
      }]);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post('/api/chat/message', {
        message: text,
        history: history.slice(-20),
      });
      const assistantMsg = { role: 'assistant', content: res.data.reply };
      const updatedHistory = [...newHistory, assistantMsg];
      setHistory(updatedHistory);

      if (res.data.pending_action) {
        setPendingActions((prev) => ({
          ...prev,
          [updatedHistory.length - 1]: res.data.pending_action,
        }));
      }
    } catch (e) {
      setHistory((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I ran into an error. Please try again.' },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontSize: 28 }}>🤖</span>
        <div>
          <div style={styles.headerTitle}>AI Financial Advisor</div>
          <div style={styles.headerSub}>Powered by GPT-4o mini · Your data stays private</div>
        </div>
      </div>

      {unavailable ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 40, background: '#f5f5f7' }}>
          <div style={{ fontSize: 56 }}>🚫</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1c1c1e' }}>AI Advisor Unavailable</div>
          <div style={{ fontSize: 15, color: '#8e8e93', textAlign: 'center', maxWidth: 380 }}>
            The OpenAI API is blocked by your corporate network. All other app features — transactions, budgets, bank sync, and category review — work normally.
          </div>
          <div style={{ fontSize: 13, color: '#c7c7cc', marginTop: 8 }}>
            To enable: connect from a personal network or set up an allowed AI endpoint.
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div style={styles.messages}>
            {history.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
                    {!isUser && <div style={styles.avatarSmall}>🤖</div>}
                    <div style={isUser ? styles.userBubble : styles.aiBubble}>
                      <MessageText text={msg.content} />
                    </div>
                    {isUser && <div style={styles.avatarSmall}>👤</div>}
                  </div>
                  {pendingActions[i] && (
                    <div style={{ paddingLeft: 44 }}>
                      <ActionCard
                        action={pendingActions[i]}
                        onConfirm={() => {
                          setPendingActions((prev) => { const next = { ...prev }; delete next[i]; return next; });
                        }}
                        onDismiss={() =>
                          setPendingActions((prev) => { const next = { ...prev }; delete next[i]; return next; })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={styles.inputRow}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask me anything about your finances, or tell me about a recent expense…"
              rows={2}
              style={styles.textarea}
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              style={styles.sendBtn}
            >
              {loading ? '…' : '➤'}
            </button>
          </div>
        </>
      )}

      {/* Typing animation keyframes injected inline */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 80px)',
    maxWidth: 800,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '18px 24px',
    background: 'linear-gradient(135deg, #1c1c1e 0%, #2c2c2e 100%)',
    color: '#fff',
    flexShrink: 0,
  },
  headerTitle: { fontSize: 18, fontWeight: 700 },
  headerSub: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#f5f5f7',
  },
  userBubble: {
    maxWidth: '70%',
    background: '#007aff',
    color: '#fff',
    borderRadius: '18px 18px 4px 18px',
    padding: '10px 14px',
    fontSize: 15,
    marginRight: 8,
  },
  aiBubble: {
    maxWidth: '72%',
    background: '#fff',
    color: '#1c1c1e',
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    fontSize: 15,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    marginLeft: 8,
  },
  avatarSmall: {
    fontSize: 22,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  actionCard: {
    background: '#fff',
    border: '2px solid #007aff',
    borderRadius: 12,
    padding: '12px 16px',
    marginTop: 6,
    marginBottom: 8,
    maxWidth: 360,
  },
  actionPrompt: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1c1c1e',
  },
  confirmBtn: {
    flex: 1,
    padding: '8px 0',
    background: '#007aff',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  cancelBtn: {
    flex: 1,
    padding: '8px 0',
    background: 'none',
    color: '#8e8e93',
    border: '1px solid #d1d1d6',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    padding: '12px 16px',
    background: '#fff',
    borderTop: '1px solid #e5e5ea',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 12,
    border: '1px solid #d1d1d6',
    fontSize: 15,
    resize: 'none',
    fontFamily: 'inherit',
    outline: 'none',
    lineHeight: 1.5,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: '#007aff',
    color: '#fff',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  typingDots: {
    display: 'flex',
    gap: 5,
    alignItems: 'center',
    background: '#fff',
    padding: '10px 14px',
    borderRadius: '18px 18px 18px 4px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  dot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#8e8e93',
    animation: 'bounce 1.2s infinite ease-in-out',
  },
};
