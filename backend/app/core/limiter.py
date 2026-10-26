from collections import deque
from time import monotonic


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float, max_clients: int):
        self.limit, self.window_seconds, self.max_clients = limit, window_seconds, max_clients
        self.clients: dict[str, deque[float]] = {}

    def allow(self, ip: str, now: float | None = None) -> bool:
        now = monotonic() if now is None else now
        cutoff = now - self.window_seconds
        for key, timestamps in list(self.clients.items()):
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if not timestamps:
                del self.clients[key]
        if ip not in self.clients:
            if len(self.clients) >= self.max_clients:
                return False
            self.clients[ip] = deque()
        timestamps = self.clients[ip]
        if len(timestamps) >= self.limit:
            return False
        timestamps.append(now)
        return True
