from typing import Annotated
from pydantic import BaseModel, ConfigDict, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
