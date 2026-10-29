-- Additive UI preferences per user (theme, density, sidebar, saved filters).
-- No existing table or row is changed.
CREATE TABLE user_preferences (
  user_id integer PRIMARY KEY REFERENCES users(id),
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  density text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','compact')),
  sidebar_collapsed boolean NOT NULL DEFAULT false,
  saved_filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(saved_filters) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
