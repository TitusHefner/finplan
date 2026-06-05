import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from '../../api';

function MessageText({ text }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
      {text.split('\n').map((line, i, arr) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <span key={i}>
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={j}>{p.slice(2, -2)}</strong>
                : p
            )}
            {i < arr.length - 1 && <br />}
          </span>
        );
      })}
    </div>
  );
}

function ActionCard({ action, onDone }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/chat/execute', { action });
      setResult({ ok: true, msg: res.data.message });
      onDone && onDone(res.data);
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.detail || 'Error' });
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div style={S.actionCardDone}>
        <span style={{ color: result.ok ? '#34c759' : '#ff3b30', fontWeight: 600 }}>
          {result.ok ? '✅ ' : '❌ '}{result.msg}
        </span>
      </div>
    );
  }

  return (
    <div style={S.actionCard}>
      <div style={S.actionPrompt}>{action.prompt}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={handleConfirm} disabled={loading} style={S.confirmBtn}>
          {loading ? '…' : '✓ Yes, add it'}
        </button>
        <button onClick={() => setResult({ ok: false, msg: 'Dismissed' })} disabled={loading} style={S.cancelBtn}>
          No thanks
        </button>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
      <div style={S.avatarDot}>🤖</div>
      <div style={S.dotsWrap}>
        {[0, 160, 320].map((d) => (
          <span key={d} style={{ ...S.dot, animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

export default function MobileChat() {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingActions, setPendingActions] = useState({});
  const [unavailable, setUnavailable] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  // Greeting + availability check
  useEffect(() => {
    axios.get('/api/chat/status').then((res) => {
      if (!res.data.available) { setUnavailable(true); return; }
      setHistory([{
        role: 'assistant',
        content: "Hi! I'm your AI financial advisor 👋\n\nAsk me anything about your finances, tell me about recent spending, or let me help you set a goal. I can see your real account data.",
      }]);
    }).catch(() => {
      setHistory([{
        role: 'assistant',
        content: "Hi! I'm your AI financial advisor 👋\n\nWhat's on your mind?",
      }]);
    });
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const withUser = [...history, userMsg];
    setHistory(withUser);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post('/api/chat/message', {
        message: text,
        history: history.slice(-20),
      });
      const aiMsg = { role: 'assistant', content: res.data.reply };
      const final = [...withUser, aiMsg];
      setHistory(final);
      if (res.data.pending_action) {
        setPendingActions((prev) => ({ ...prev, [final.length - 1]: res.data.pending_action }));
      }
    } catch {
      setHistory((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, history, loading]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={S.container}>
      <style>{`
        @keyframes mcBounce {
          0%,80%,100%{transform:translateY(0);opacity:.4}
          40%{transform:translateY(-5px);opacity:1}
        }
      `}</style>

      {/* Header */}
      <div className="m-card" style={S.header}>
        <span style={{ fontSize: 24 }}>🤖</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>AI Financial Advisor</div>
          <div style={{ fontSize: 12, color: '#8e8e93' }}>Your personal money coach</div>
        </div>
      </div>

      {unavailable ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <div style={{ fontSize: 48 }}>🚫</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e' }}>AI Unavailable</div>
          <div style={{ fontSize: 14, color: '#8e8e93', textAlign: 'center' }}>
            The OpenAI API is blocked on this network. All other features still work normally.
          </div>
        </div>
      ) : (
        <>
          {/* Message list */}
          <div style={S.messages}>
            {history.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
                    {!isUser && <div style={S.avatarDot}>🤖</div>}
                    <div style={isUser ? S.userBubble : S.aiBubble}>
                      <MessageText text={msg.content} />
                    </div>
                    {isUser && <div style={S.avatarDot}>👤</div>}
                  </div>
                  {pendingActions[i] && (
                    <div style={{ paddingLeft: 36 }}>
                      <ActionCard
                        action={pendingActions[i]}
                        onDone={() =>
                          setPendingActions((prev) => { const n = { ...prev }; delete n[i]; return n; })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {loading && <TypingDots />}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div style={S.inputBar}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Message your advisor…"
              rows={1}
              style={S.textarea}
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              style={{ ...S.sendBtn, background: !input.trim() || loading ? '#c7c7cc' : '#007aff' }}
            >
              ➤
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const S = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderRadius: 0,
    margin: 0,
    flexShrink: 0,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  userBubble: {
    maxWidth: '75%',
    background: '#007aff',
    color: '#fff',
    borderRadius: '18px 18px 4px 18px',
    padding: '9px 13px',
    fontSize: 14,
    marginRight: 6,
  },
  aiBubble: {
    maxWidth: '78%',
    background: '#fff',
    color: '#1c1c1e',
    borderRadius: '18px 18px 18px 4px',
    padding: '9px 13px',
    fontSize: 14,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    marginLeft: 6,
  },
  avatarDot: {
    fontSize: 18,
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  actionCard: {
    background: '#f0f8ff',
    border: '1.5px solid #007aff',
    borderRadius: 12,
    padding: '10px 12px',
    marginTop: 4,
    marginBottom: 6,
  },
  actionCardDone: {
    background: '#f9f9fb',
    border: '1px solid #e5e5ea',
    borderRadius: 12,
    padding: '8px 12px',
    marginTop: 4,
    marginBottom: 6,
    fontSize: 13,
  },
  actionPrompt: { fontSize: 13, fontWeight: 600, color: '#1c1c1e' },
  confirmBtn: {
    flex: 1,
    padding: '8px 0',
    background: '#007aff',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  cancelBtn: {
    flex: 1,
    padding: '8px 0',
    background: 'none',
    color: '#8e8e93',
    border: '1px solid #d1d1d6',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
  inputBar: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    background: '#fff',
    borderTop: '1px solid #e5e5ea',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    padding: '9px 12px',
    borderRadius: 20,
    border: '1px solid #d1d1d6',
    fontSize: 14,
    resize: 'none',
    fontFamily: 'inherit',
    outline: 'none',
    lineHeight: 1.4,
    maxHeight: 100,
    overflowY: 'auto',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    color: '#fff',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
    flexShrink: 0,
  },
  dotsWrap: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    background: '#fff',
    padding: '8px 12px',
    borderRadius: '18px 18px 18px 4px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  dot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#8e8e93',
    animation: 'mcBounce 1.2s infinite ease-in-out',
  },
};
