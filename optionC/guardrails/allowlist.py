class ModelNotAllowedError(Exception):
    def __init__(self, model: str, allowed: list[str]):
        self.model = model
        self.allowed = allowed
        super().__init__(f"Model '{model}' not in allowlist: {allowed}")


class ModelAllowlist:
    def check(self, model: str, allowed: list[str]) -> None:
        if model not in allowed:
            raise ModelNotAllowedError(model, allowed)
