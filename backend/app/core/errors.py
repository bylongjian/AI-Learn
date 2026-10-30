class AppError(Exception):
    def __init__(self, code: int, message: str, status_code: int = 503):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class TopicClarification(AppError):
    def __init__(self, options):
        super().__init__(40902, "这个主题有多个含义，请选择你想学习的领域", 409)
        self.options = [{"label": option.label, "description": option.description} for option in options]
