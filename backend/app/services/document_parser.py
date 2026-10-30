"""Extract plain text in an interruptible process; never load a vector database here."""
import asyncio
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import subprocess
import sys
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile


class DocumentParseError(Exception):
    pass


@dataclass
class DocumentChunk:
    text: str
    index: int
    page: int | None = None


def extract(path, chunk_size, overlap):
    import docx2txt
    from pypdf import PdfReader
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=overlap,
        separators=["\n\n", "\n", "。", "！", "？", ". ", "，", " ", ""])
    if path.suffix == '.pdf':
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise DocumentParseError("请上传无需密码且可复制文字的 PDF")
        pages = [(page.extract_text() or '', i + 1) for i, page in enumerate(reader.pages)]
    elif path.suffix == '.docx':
        pages = [(docx2txt.process(path), None)]
    else:
        pages = [(path.read_text(encoding='utf-8-sig'), None)]
    chunks = []
    for text, page in pages:
        for part in splitter.split_text(text):
            if part.strip():
                chunks.append(DocumentChunk(part, len(chunks), page))
    if not chunks:
        raise DocumentParseError("没有可提取的文字，请上传可复制文字的文档；暂不支持 OCR")
    return chunks


async def parse_upload(path: Path, *, chunk_size: int, overlap: int, timeout: float):
    output = path.with_suffix('.chunks.jsonl')
    process = None
    try:
        process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'app.services.document_parser',
            str(path), str(output), str(chunk_size), str(overlap),
            cwd=Path(__file__).resolve().parents[2],
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout)
        if process.returncode != 0:
            raise DocumentParseError(stdout.decode('utf-8').strip() or '文档无法解析，请上传未损坏且可复制文字的文件')
        return [DocumentChunk(**json.loads(line)) for line in output.read_text(encoding='utf-8').splitlines()]
    finally:
        if process is not None and process.returncode is None:
            process.terminate()
            await process.wait()
        path.unlink(missing_ok=True)
        output.unlink(missing_ok=True)


if __name__ == '__main__':
    from pypdf.errors import PdfReadError
    source, target = Path(sys.argv[1]), Path(sys.argv[2])
    try:
        chunks = extract(source, int(sys.argv[3]), int(sys.argv[4]))
        target.write_text('\n'.join(json.dumps(asdict(chunk), ensure_ascii=False) for chunk in chunks), encoding='utf-8')
    except DocumentParseError as exc:
        sys.stdout.buffer.write(str(exc).encode('utf-8'))
        sys.exit(1)
    except (PdfReadError, BadZipFile, ParseError, UnicodeError, OSError, KeyError, ValueError):
        sys.stdout.buffer.write('文件无法读取，请检查文件是否损坏，文本请另存为 UTF-8'.encode('utf-8'))
        sys.exit(1)
    finally:
        source.unlink(missing_ok=True)
