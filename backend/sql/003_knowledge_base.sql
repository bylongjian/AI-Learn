CREATE TABLE IF NOT EXISTS kb_documents (
    doc_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(8) NOT NULL,
    file_size INT UNSIGNED NOT NULL,
    status ENUM('processing','ready','failed','deleting','delete_failed') NOT NULL DEFAULT 'processing',
    chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
    embedding_profile VARCHAR(64) NOT NULL,
    error_code VARCHAR(64) NULL,
    error_message VARCHAR(300) NULL,
    cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deadline_at DATETIME(6) NOT NULL,
    KEY knowledge_owner_created (user_id,created_at,doc_id),
    CONSTRAINT knowledge_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
