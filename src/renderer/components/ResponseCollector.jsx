export function ResponseCollector({
  activeProjectId,
  responses,
  onSaveResponse
}) {
  async function handleSave(response) {
    if (!activeProjectId) {
      return;
    }

    const title = window.prompt("Decision title", `${response.agentName} summary`);

    if (!title?.trim()) {
      return;
    }

    await onSaveResponse({
      title: title.trim(),
      content: response.response,
      category: "other"
    });
  }

  return (
    <section className="panel response-panel">
      <div className="panel-header">
        <h2>Responses</h2>
        <span className="pill">{responses.length}</span>
      </div>

      {responses.length === 0 ? (
        <p className="empty-state">Completed responses will appear here.</p>
      ) : (
        <div className="response-list">
          {responses.map((response) => (
            <article key={response.id} className="response-card">
              <header className="response-card-header">
                <div>
                  <strong>{response.agentName}</strong>
                  <div className="agent-meta">
                    {new Date(response.timestamp).toLocaleString()}
                  </div>
                </div>
                <button type="button" onClick={() => handleSave(response)}>
                  Save to KB
                </button>
              </header>
              <pre>{response.response}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

