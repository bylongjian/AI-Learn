"""Run from backend: python -m scripts.init_db [--env-file .env.test]."""
import argparse
import asyncio

from app.core.config import Settings
from app.storage import Database, initialize_schema


async def initialize(env_file):
    database = Database(Settings(_env_file=env_file))
    try:
        await initialize_schema(database)
    finally:
        await database.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Initialize the configured MySQL user tables")
    parser.add_argument("--env-file", default=".env")
    arguments = parser.parse_args()
    asyncio.run(initialize(arguments.env_file))
    print("User tables initialized.")
