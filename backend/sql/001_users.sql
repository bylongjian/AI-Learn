CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    openid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
    nickname VARCHAR(100) NOT NULL DEFAULT '学习者',
    avatar_url VARCHAR(500) NOT NULL DEFAULT '',
    total_xp BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    quiz_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    user_input TEXT NOT NULL,
    questions JSON NOT NULL,
    `reference` JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY quiz_owner (quiz_id, user_id),
    KEY user_created (user_id, created_at, id),
    CONSTRAINT quiz_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS answer_records (
    quiz_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    records JSON NOT NULL,
    correct_count INT UNSIGNED NOT NULL,
    total_questions INT UNSIGNED NOT NULL,
    accuracy INT UNSIGNED NOT NULL,
    KEY answer_user (user_id),
    CONSTRAINT answer_owner_fk FOREIGN KEY (quiz_id, user_id) REFERENCES quiz_sessions(quiz_id, user_id),
    CONSTRAINT answer_score_check CHECK (correct_count <= total_questions AND total_questions > 0 AND accuracy <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
    quiz_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    report JSON NOT NULL,
    CONSTRAINT report_owner_fk FOREIGN KEY (quiz_id, user_id) REFERENCES quiz_sessions(quiz_id, user_id),
    CONSTRAINT report_answer_fk FOREIGN KEY (quiz_id) REFERENCES answer_records(quiz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
