/* Dust AI assistant sidebar — uses window.claude.complete */

const DUST_SUGGESTIONS = [
  "Summarize the Mercier Industries bid",
  "What are the top risks across my open bids?",
  "Draft a follow-up email for BID-2026-0114",
  "Which bids are at risk of slipping this quarter?",
];

const DustAssistant = ({ open, onClose, opp }) => {
  const [messages, setMessages] = React.useState([
    { role:"assistant", content: "Hi Jane — I'm your Dust agent for BidStack 360°. I can summarize bids, draft proposal sections, surface risks, and pull insights from your pipeline. What would you like to do?" },
  ]);
  const [input, setInput] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const send = async (text) => {
    const userText = (text ?? input).trim();
    if (!userText || thinking) return;
    const next = [...messages, { role:"user", content: userText }];
    setMessages(next);
    setInput("");
    setThinking(true);

    const context = opp
      ? `\n\nThe user is currently viewing opportunity ${opp.id} (${opp.customer}, ${opp.name}). Stage: ${stageName(opp.stage)}. Value: ${window.formatMoney(opp.value, opp.currency)}. Win probability: ${opp.probability}%. Health: ${opp.health}/100. Deadline: ${opp.deadline}.`
      : "";

    const system = `You are Dust, an AI assistant embedded in BidStack 360°, a CRM Mantu's bid managers use to manage IT-services RFPs and proposals. Be concise, structured, and pragmatic. Use short paragraphs and bullet lists. When suggesting actions, format them as clear next steps. Never invent specific dollar figures or dates that weren't given to you. If you reference a bid, refer to it by ID.${context}`;

    try {
      const reply = await window.claude.complete({
        messages: [
          { role:"user", content: system + "\n\nUser: " + userText }
        ]
      });
      setMessages(m => [...m, { role:"assistant", content: reply }]);
    } catch (e) {
      setMessages(m => [...m, { role:"assistant", content: "I couldn't reach the model just now. Please try again in a moment." }]);
    } finally {
      setThinking(false);
    }
  };

  if (!open) return null;
  return (
    <aside className="dust-panel">
      <div className="dust-head">
        <div className="dust-id">
          <div className="dust-mark">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15.5L5 12l1.5-1.5L10 14l7.5-7.5L19 8l-9 9.5z"/></svg>
          </div>
          <div>
            <div style={{fontWeight:600, fontSize:14, display:"flex", alignItems:"center", gap:8}}>
              Dust assistant
              <span className="pill" style={{background:"var(--success-tint)", color:"var(--success)", padding:"2px 8px", fontSize:10}}>
                <span className="dot" style={{background:"var(--success)"}} />Online
              </span>
            </div>
            <div className="t-xs text-tertiary">{opp ? `Context · ${opp.id}` : "Workspace context"}</div>
          </div>
        </div>
        <button className="iconbtn" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>

      <div className="dust-msgs" ref={scrollRef}>
        {messages.map((m, i) => (
          <DustMessage key={i} role={m.role} content={m.content} />
        ))}
        {thinking && (
          <div className="dust-msg assistant">
            <div className="dust-bubble thinking">
              <span className="td"></span><span className="td"></span><span className="td"></span>
            </div>
          </div>
        )}
      </div>

      {messages.length <= 1 && (
        <div className="dust-suggest">
          <div className="t-xs text-tertiary" style={{marginBottom:6, padding:"0 4px"}}>Try asking</div>
          {DUST_SUGGESTIONS.map(s => (
            <button key={s} className="suggest-chip" onClick={()=>send(s)}>
              <Icon name="sparkle" size={11} />
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="dust-compose">
        <textarea
          rows="1"
          placeholder="Ask Dust about your pipeline…"
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn btn-primary btn-sm" onClick={()=>send()} disabled={!input.trim() || thinking}>
          <Icon name="arrow" size={14} />
        </button>
      </div>
      <div className="dust-foot">
        <Icon name="sparkle" size={11} />
        Powered by Dust · responses use the connected Dust agent
      </div>
    </aside>
  );
};

const DustMessage = ({ role, content }) => {
  // simple markdown: lines starting with -, **bold**, paragraphs
  const blocks = content.trim().split(/\n\s*\n/);
  const renderInline = (txt) => txt.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2,-2)}</b> : <React.Fragment key={i}>{p}</React.Fragment>
  );
  return (
    <div className={"dust-msg " + role}>
      {role === "assistant" && (
        <div className="dust-avatar">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15.5L5 12l1.5-1.5L10 14l7.5-7.5L19 8l-9 9.5z"/></svg>
        </div>
      )}
      <div className="dust-bubble">
        {blocks.map((b, i) => {
          const lines = b.split("\n");
          if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
            return (
              <ul key={i}>
                {lines.map((l, j) => <li key={j}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}
              </ul>
            );
          }
          if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) {
            return (
              <ol key={i}>
                {lines.map((l, j) => <li key={j}>{renderInline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}
              </ol>
            );
          }
          return <p key={i}>{renderInline(b)}</p>;
        })}
      </div>
    </div>
  );
};

Object.assign(window, { DustAssistant });
