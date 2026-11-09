"""Reject generated markup outside a small, inert HTML/CSS language.

This is validation, not sanitization: invalid model output is replaced by the
trusted template. The attendee renderer must still use its sandbox and CSP.
"""
from html.parser import HTMLParser
import re

MAX_PAGE_BYTES = 60_000
SESSION_ID = re.compile(r"sess-[0-9]{3}\Z")
TAGS = set("html head meta title style body main header footer section article nav div span h1 h2 h3 h4 p ul ol li dl dt dd time button strong em small br hr svg g path circle rect line polyline polygon ellipse".split())
VOID = {"meta", "br", "hr"}
GLOBAL_ATTRS = {"id", "class", "lang", "role", "aria-label", "aria-labelledby", "aria-describedby", "aria-hidden", "tabindex", "data-session-id", "data-action"}
SVG_TAGS = {"svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse"}
SVG_ATTRS = {"viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule"}
PROPERTIES = set("color background background-color border border-top border-bottom border-left border-right border-color border-width border-style border-radius padding padding-top padding-right padding-bottom padding-left padding-inline padding-block margin margin-top margin-right margin-bottom margin-left margin-inline margin-block width min-width max-width height min-height max-height display flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self justify-content gap row-gap column-gap grid-template-columns grid-column grid-row font-family font-size font-weight line-height letter-spacing text-align text-decoration text-transform list-style list-style-type box-sizing overflow-wrap word-break outline outline-offset cursor animation transition scroll-behavior position visibility opacity".split())
FUNCTIONS = {"rgb", "hsl", "calc", "min", "max", "clamp", "repeat", "minmax"}


class ValidationError(ValueError):
    """A fixed, non-sensitive error suitable for a rejected/fallback ledger."""


def _fail(reason):
    raise ValidationError(reason)


def _declarations(text, accessibility):
    declarations = {}
    for part in text.split(";"):
        if not part.strip():
            continue
        if ":" not in part:
            _fail("Invalid CSS declaration")
        name, value = (piece.strip().lower() for piece in part.split(":", 1))
        if name not in PROPERTIES or not value or not re.fullmatch(r"[a-z0-9#.,%()+*/!\s-]+", value):
            _fail("CSS property or value is not allowed")
        if ":" in value or "!" in value or any(fn not in FUNCTIONS for fn in re.findall(r"([a-z-]+)\s*\(", value)):
            _fail("CSS function is not allowed")
        if name in {"animation", "transition"} and value != "none":
            _fail("Generated pages cannot animate")
        if name == "scroll-behavior" and value != "auto":
            _fail("Generated pages cannot force motion")
        if name == "position" and value not in {"static", "relative"}:
            _fail("Generated layout must stay in document flow")
        if name == "visibility" and value != "visible" or name == "opacity" and value != "1":
            _fail("Generated content must remain visible")
        if name == "display" and value not in {"block", "inline", "inline-block", "flex", "grid", "inline-flex", "inline-grid"}:
            _fail("Generated content must remain visible")
        if name == "font-family" and value not in {"system-ui", "system-ui, sans-serif", "system-ui,sans-serif", "sans-serif", "monospace", "ui-monospace, monospace"}:
            _fail("Use system fonts only")
        if name == "font-size":
            size = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(px|rem|em)", value)
            if not size or float(size[1]) < (20 if "large_text" in accessibility else 12) / (1 if size[2] == "px" else (20 if "large_text" in accessibility else 16)):
                _fail("Text is too small")
        if "high_contrast" in accessibility:
            if name == "color" and value not in {"#000", "#000000", "black"}:
                _fail("High contrast text must be black")
            if name in {"background", "background-color"} and value not in {"#fff", "#ffffff", "white"}:
                _fail("High contrast background must be white")
        declarations[name] = value
    return declarations


def validate_css(css, accessibility=()):
    if any(char in css for char in ('\\', '<', '>', '"', "'", '[', ']', '\x00')):
        _fail("CSS escape, resource or markup syntax is not allowed")
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    if "/*" in css or "*/" in css:
        _fail("Unterminated CSS comment")
    if re.search(r"(?:url|expression|image|image-set|paint)\s*\(|@import|javascript|data:|https?:|//", css, re.I):
        _fail("CSS resources are forbidden")
    body_rules = {}
    reduced = False

    def rules(text, nested=False):
        nonlocal reduced
        while text.strip():
            text = text.lstrip()
            opening = text.find("{")
            if opening < 1:
                _fail("Invalid CSS rule")
            selector = text[:opening].strip().lower()
            depth, end = 1, opening + 1
            while end < len(text) and depth:
                depth += (text[end] == "{") - (text[end] == "}")
                end += 1
            if depth:
                _fail("Unbalanced CSS block")
            content = text[opening + 1:end - 1]
            text = text[end:]
            if selector.startswith("@"):
                if nested or not re.fullmatch(r"@media\s*\(\s*(?:prefers-reduced-motion\s*:\s*reduce|(?:min|max)-width\s*:\s*[0-9]+(?:px|rem))\s*\)", selector):
                    _fail("CSS at-rule is not allowed")
                if "prefers-reduced-motion" in selector:
                    reduced = True
                rules(content, True)
            else:
                if not re.fullmatch(r"[a-z0-9_.*#,:\s-]+", selector) or "{" in content or "}" in content:
                    _fail("CSS selector is not allowed")
                if any(pseudo not in {"hover", "focus", "focus-visible", "first-child", "last-child"} for pseudo in re.findall(r":([a-z-]+)", selector)):
                    _fail("CSS pseudo selector is not allowed")
                declarations = _declarations(content, accessibility)
                if selector == "body" and not nested:
                    body_rules.update(declarations)
    rules(css)
    if not reduced:
        _fail("A reduced-motion media rule is required")
    if not {"font-family", "font-size", "color"}.issubset(body_rules) or not ({"background", "background-color"} & body_rules.keys()):
        _fail("Body text, background and system font must be explicit")
    if "large_text" in accessibility and body_rules["font-size"] not in {"20px", "21px", "22px", "24px", "1.25rem", "1.5rem"}:
        _fail("Large text needs an explicit accessible base size")


class _Page(HTMLParser):
    def __init__(self, sessions, accessibility):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.counts = {}
        self.cards = {}
        self.active_card = None
        self.styles = []
        self.accessibility = accessibility
        self.expected = {s["session_id"]: s["title"] for s in sessions}
        self.doctype = False
        self.head_closed = False
        self.body_closed = False

    def handle_decl(self, decl):
        if decl.lower() != "doctype html" or self.doctype or self.stack:
            _fail("Only the HTML doctype is allowed")
        self.doctype = True

    def unknown_decl(self, data):
        _fail("Unknown declaration")

    def handle_pi(self, data):
        _fail("Processing instructions are forbidden")

    def handle_comment(self, data):
        _fail("HTML comments are not allowed")

    def handle_starttag(self, tag, attrs):
        if tag not in TAGS or not self.doctype or self.body_closed:
            _fail("Unexpected or forbidden HTML tag")
        if not self.stack and tag != "html" or tag == "html" and self.stack:
            _fail("One complete HTML document is required")
        if tag in {"head", "body"} and self.stack != ["html"]:
            _fail("Invalid document structure")
        if tag == "head" and self.head_closed or tag == "body" and not self.head_closed:
            _fail("Head must precede body")
        if tag not in {"head", "body", "html"} and self.stack == ["html"]:
            _fail("Content must be inside head or body")
        if tag in {"style", "meta"} and (not self.stack or self.stack[-1] != "head"):
            _fail("Styles and metadata belong in head")
        if "head" in self.stack and tag not in {"style", "title", "meta"}:
            _fail("Forbidden head content")
        if tag in SVG_TAGS - {"svg"} and "svg" not in self.stack:
            _fail("SVG shapes need an SVG parent")
        self.counts[tag] = self.counts.get(tag, 0) + 1
        if tag in {"html", "head", "body", "style"} and self.counts[tag] > 1:
            _fail("Duplicate document element")
        values = dict(attrs)
        if len(values) != len(attrs):
            _fail("Duplicate attributes")
        for name, value in attrs:
            if value is None or len(value) > 2000:
                _fail("Invalid attribute")
            allowed = GLOBAL_ATTRS | (SVG_ATTRS if tag in SVG_TAGS else set()) | ({"charset", "name", "content"} if tag == "meta" else set()) | ({"type"} if tag == "button" else set()) | ({"datetime"} if tag == "time" else set())
            if name not in allowed or name.startswith("on"):
                _fail("Attribute is not allowed")
            if re.search(r"(?:[a-z][a-z0-9+.-]*://|(?:javascript|data|vbscript|file|mailto|tel):|//|\\)", value, re.I) and name != "datetime":
                _fail("URLs and escaped attribute values are forbidden")
            if tag in SVG_TAGS and name in SVG_ATTRS and not re.fullmatch(r"[a-zA-Z0-9#.,\s+%-]+", value):
                _fail("Unsafe SVG value")
            if name == "data-session-id":
                if value not in self.expected or not SESSION_ID.fullmatch(value) or self.active_card is not None or value in self.cards:
                    _fail("Unknown or duplicate session card")
                if tag not in {"article", "section", "div", "li"}:
                    _fail("Session ID needs a card container")
                self.active_card = (tag, len(self.stack), value)
                self.cards[value] = []
            if name == "data-action" and (tag != "button" or value not in {"save", "dismiss"} or self.active_card is None):
                _fail("Invalid session action")
            if name == "tabindex" and value not in {"0", "-1"}:
                _fail("Invalid tab order")
            if name == "aria-hidden" and (tag not in SVG_TAGS or value not in {"true", "false"}):
                _fail("Session content must not be hidden")
        if tag == "button" and values.get("type") != "button":
            _fail("Buttons must be inert buttons")
        if tag == "meta" and values not in ({"charset": "utf-8"}, {"name": "viewport", "content": "width=device-width, initial-scale=1"}):
            _fail("Only charset and viewport metadata are allowed")
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            _fail("HTML tags must be balanced")
        if self.active_card and (tag, len(self.stack) - 1) == self.active_card[:2]:
            self.active_card = None
        self.stack.pop()
        if tag == "head":
            self.head_closed = True
        if tag == "body":
            self.body_closed = True

    def handle_data(self, data):
        if not self.stack and data.strip():
            _fail("Text outside the document")
        if self.stack and self.stack[-1] == "style":
            self.styles.append(data)
        elif self.active_card:
            self.cards[self.active_card[2]].append(data)


def validate_page(html, sessions, accessibility=()):
    """Raise ValidationError; return None only for a complete inert page."""
    if not isinstance(html, str) or len(html.encode("utf-8")) > MAX_PAGE_BYTES or "\x00" in html:
        _fail("HTML exceeds the page limit or contains invalid text")
    if html.count("<head>") != 1:
        _fail("Exactly one literal head element is required")
    parser = _Page(sessions, accessibility)
    try:
        parser.feed(html)
        parser.close()
    except (KeyError, TypeError, RecursionError) as error:
        raise ValidationError("Invalid page structure") from error
    if parser.stack or any(parser.counts.get(tag) != 1 for tag in ("html", "head", "body", "style")) or not parser.doctype:
        _fail("One complete HTML document with inline style is required")
    if set(parser.cards) != set(parser.expected):
        _fail("Every recommended session needs one card")
    for session_id, title in parser.expected.items():
        if " ".join(title.split()) not in " ".join(" ".join(parser.cards[session_id]).split()):
            _fail("Session title is missing from its card")
    validate_css("".join(parser.styles), accessibility)
