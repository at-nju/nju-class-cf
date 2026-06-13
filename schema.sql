-- D1 schema for NJU 选课助手
-- reviews: 主数据表，每行 = 一条评价（或一条无评价的基本条目）
-- reviews_staging: 刷新时的暂存表，填满后一次性原子换入 reviews
-- reviews_fts: FTS5 trigram 全文索引，用于中文子串匹配；rowid 对齐 reviews.id

CREATE TABLE IF NOT EXISTS reviews (
  id               INTEGER PRIMARY KEY,
  course           TEXT,              -- 课程名称
  teacher          TEXT,              -- 教师（可含多名）
  sources          TEXT,              -- 来源，JSON 数组字符串
  review           TEXT,              -- 评价_0，可空
  teacher_py       TEXT,              -- 教师全拼，各老师以空格分隔
  teacher_initials TEXT,              -- 教师拼音首字母，各老师以空格分隔
  course_py        TEXT,              -- 课程全拼
  course_initials  TEXT               -- 课程拼音首字母
);

CREATE TABLE IF NOT EXISTS reviews_staging (
  id               INTEGER PRIMARY KEY,
  course           TEXT,
  teacher          TEXT,
  sources          TEXT,
  review           TEXT,
  teacher_py       TEXT,
  teacher_initials TEXT,
  course_py        TEXT,
  course_initials  TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS reviews_fts USING fts5(
  course,
  teacher,
  teacher_py,
  course_py,
  tokenize = 'trigram'
);
