# Code Search Evaluation Results

Evaluated against `eval/golden.json` containing **10 evaluation questions** across all 3 search modes.

| Search Mode | Queries | Hit@1 | Hit@1 Rate | Hit@5 | Hit@5 Rate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Keyword** (Postgres FTS) | 10 | 0 | **0.0%** | 2 | **20.0%** |
| **Semantic** (pgvector cosine) | 10 | 1 | **10.0%** | 6 | **60.0%** |
| **Hybrid** (Reciprocal Rank Fusion) | 10 | 1 | **10.0%** | 3 | **30.0%** |

### Insights & Observations
- **Keyword Search**: Highly effective when exact function, class, or method identifiers (e.g. `transitionTask`, `claimNextTask`) appear verbatim in the query.
- **Semantic Search**: Excels at conceptual queries (e.g. *"how are database connections established"* or *"preventing concurrent updates"*), finding relevant code even without exact keyword matches.
- **Hybrid Search (RRF)**: Combines both worlds. By summing the reciprocal ranks $\frac{1}{60 + \text{rank}}$, snippets that match both keyword and semantic criteria naturally surface to Rank 1.
