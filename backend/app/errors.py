class Rejected(Exception):
    """A request the rules don't allow. Rendered as {"detail": message} with the given status."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail
