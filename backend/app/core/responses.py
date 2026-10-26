from starlette.responses import JSONResponse


def error_response(code: int, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code, "message": message, "data": None})
