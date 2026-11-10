-- Extraction BACKTEST VOLTRIX MMA — données BRUTES uniquement.
-- Stats par combat : sommes des rounds de fight_stats_core (entiers bruts,
-- rounds non disputés = 0). Durée : fight_stats_derived.time_sec (vérifié
-- brut et identique pour les deux combattants). Cotes : features.odds.
-- Une ligne = un combat, ordre chronologique.
SELECT json_build_object(
  'id', fm.fight_id,
  'd', to_char(e.event_date, 'YYYY-MM-DD'),
  'wc', fm.weightclass,
  'm', fm.method,
  'r', fm.end_round,
  'res', fm.result,
  'f1', json_build_object('id', f1.fighter_id, 'n', f1.fighter_name,
                          'reach', f1.fighter_reach, 'dob', to_char(f1.fighter_dob, 'YYYY-MM-DD')),
  'f2', json_build_object('id', f2.fighter_id, 'n', f2.fighter_name,
                          'reach', f2.fighter_reach, 'dob', to_char(f2.fighter_dob, 'YYYY-MM-DD')),
  's1', json_build_object(
    't', d1.time_sec,
    'kd',  COALESCE(c1.kd_rd1,0)+COALESCE(c1.kd_rd2,0)+COALESCE(c1.kd_rd3,0)+COALESCE(c1.kd_rd4,0)+COALESCE(c1.kd_rd5,0),
    'ssl', COALESCE(c1.sig_str_land_rd1,0)+COALESCE(c1.sig_str_land_rd2,0)+COALESCE(c1.sig_str_land_rd3,0)+COALESCE(c1.sig_str_land_rd4,0)+COALESCE(c1.sig_str_land_rd5,0),
    'ssa', COALESCE(c1.sig_str_att_rd1,0)+COALESCE(c1.sig_str_att_rd2,0)+COALESCE(c1.sig_str_att_rd3,0)+COALESCE(c1.sig_str_att_rd4,0)+COALESCE(c1.sig_str_att_rd5,0),
    'tl',  COALESCE(c1.td_land_rd1,0)+COALESCE(c1.td_land_rd2,0)+COALESCE(c1.td_land_rd3,0)+COALESCE(c1.td_land_rd4,0)+COALESCE(c1.td_land_rd5,0),
    'ta',  COALESCE(c1.td_att_rd1,0)+COALESCE(c1.td_att_rd2,0)+COALESCE(c1.td_att_rd3,0)+COALESCE(c1.td_att_rd4,0)+COALESCE(c1.td_att_rd5,0),
    'sa',  COALESCE(c1.sub_att_rd1,0)+COALESCE(c1.sub_att_rd2,0)+COALESCE(c1.sub_att_rd3,0)+COALESCE(c1.sub_att_rd4,0)+COALESCE(c1.sub_att_rd5,0),
    'rev', COALESCE(c1.rev_rd1,0)+COALESCE(c1.rev_rd2,0)+COALESCE(c1.rev_rd3,0)+COALESCE(c1.rev_rd4,0)+COALESCE(c1.rev_rd5,0),
    'ctrl',COALESCE(c1.ctrl_rd1,0)+COALESCE(c1.ctrl_rd2,0)+COALESCE(c1.ctrl_rd3,0)+COALESCE(c1.ctrl_rd4,0)+COALESCE(c1.ctrl_rd5,0),
    'hl',  COALESCE(c1.head_land_rd1,0)+COALESCE(c1.head_land_rd2,0)+COALESCE(c1.head_land_rd3,0)+COALESCE(c1.head_land_rd4,0)+COALESCE(c1.head_land_rd5,0),
    'ha',  COALESCE(c1.head_att_rd1,0)+COALESCE(c1.head_att_rd2,0)+COALESCE(c1.head_att_rd3,0)+COALESCE(c1.head_att_rd4,0)+COALESCE(c1.head_att_rd5,0),
    'bl',  COALESCE(c1.body_land_rd1,0)+COALESCE(c1.body_land_rd2,0)+COALESCE(c1.body_land_rd3,0)+COALESCE(c1.body_land_rd4,0)+COALESCE(c1.body_land_rd5,0),
    'ba',  COALESCE(c1.body_att_rd1,0)+COALESCE(c1.body_att_rd2,0)+COALESCE(c1.body_att_rd3,0)+COALESCE(c1.body_att_rd4,0)+COALESCE(c1.body_att_rd5,0),
    'll',  COALESCE(c1.leg_land_rd1,0)+COALESCE(c1.leg_land_rd2,0)+COALESCE(c1.leg_land_rd3,0)+COALESCE(c1.leg_land_rd4,0)+COALESCE(c1.leg_land_rd5,0),
    'la',  COALESCE(c1.leg_att_rd1,0)+COALESCE(c1.leg_att_rd2,0)+COALESCE(c1.leg_att_rd3,0)+COALESCE(c1.leg_att_rd4,0)+COALESCE(c1.leg_att_rd5,0),
    'dl',  COALESCE(c1.distance_land_rd1,0)+COALESCE(c1.distance_land_rd2,0)+COALESCE(c1.distance_land_rd3,0)+COALESCE(c1.distance_land_rd4,0)+COALESCE(c1.distance_land_rd5,0),
    'da',  COALESCE(c1.distance_att_rd1,0)+COALESCE(c1.distance_att_rd2,0)+COALESCE(c1.distance_att_rd3,0)+COALESCE(c1.distance_att_rd4,0)+COALESCE(c1.distance_att_rd5,0),
    'cl',  COALESCE(c1.clinch_land_rd1,0)+COALESCE(c1.clinch_land_rd2,0)+COALESCE(c1.clinch_land_rd3,0)+COALESCE(c1.clinch_land_rd4,0)+COALESCE(c1.clinch_land_rd5,0),
    'ca',  COALESCE(c1.clinch_att_rd1,0)+COALESCE(c1.clinch_att_rd2,0)+COALESCE(c1.clinch_att_rd3,0)+COALESCE(c1.clinch_att_rd4,0)+COALESCE(c1.clinch_att_rd5,0),
    'gl',  COALESCE(c1.ground_land_rd1,0)+COALESCE(c1.ground_land_rd2,0)+COALESCE(c1.ground_land_rd3,0)+COALESCE(c1.ground_land_rd4,0)+COALESCE(c1.ground_land_rd5,0),
    'ga',  COALESCE(c1.ground_att_rd1,0)+COALESCE(c1.ground_att_rd2,0)+COALESCE(c1.ground_att_rd3,0)+COALESCE(c1.ground_att_rd4,0)+COALESCE(c1.ground_att_rd5,0)),
  's2', json_build_object(
    't', d2.time_sec,
    'kd',  COALESCE(c2.kd_rd1,0)+COALESCE(c2.kd_rd2,0)+COALESCE(c2.kd_rd3,0)+COALESCE(c2.kd_rd4,0)+COALESCE(c2.kd_rd5,0),
    'ssl', COALESCE(c2.sig_str_land_rd1,0)+COALESCE(c2.sig_str_land_rd2,0)+COALESCE(c2.sig_str_land_rd3,0)+COALESCE(c2.sig_str_land_rd4,0)+COALESCE(c2.sig_str_land_rd5,0),
    'ssa', COALESCE(c2.sig_str_att_rd1,0)+COALESCE(c2.sig_str_att_rd2,0)+COALESCE(c2.sig_str_att_rd3,0)+COALESCE(c2.sig_str_att_rd4,0)+COALESCE(c2.sig_str_att_rd5,0),
    'tl',  COALESCE(c2.td_land_rd1,0)+COALESCE(c2.td_land_rd2,0)+COALESCE(c2.td_land_rd3,0)+COALESCE(c2.td_land_rd4,0)+COALESCE(c2.td_land_rd5,0),
    'ta',  COALESCE(c2.td_att_rd1,0)+COALESCE(c2.td_att_rd2,0)+COALESCE(c2.td_att_rd3,0)+COALESCE(c2.td_att_rd4,0)+COALESCE(c2.td_att_rd5,0),
    'sa',  COALESCE(c2.sub_att_rd1,0)+COALESCE(c2.sub_att_rd2,0)+COALESCE(c2.sub_att_rd3,0)+COALESCE(c2.sub_att_rd4,0)+COALESCE(c2.sub_att_rd5,0),
    'rev', COALESCE(c2.rev_rd1,0)+COALESCE(c2.rev_rd2,0)+COALESCE(c2.rev_rd3,0)+COALESCE(c2.rev_rd4,0)+COALESCE(c2.rev_rd5,0),
    'ctrl',COALESCE(c2.ctrl_rd1,0)+COALESCE(c2.ctrl_rd2,0)+COALESCE(c2.ctrl_rd3,0)+COALESCE(c2.ctrl_rd4,0)+COALESCE(c2.ctrl_rd5,0),
    'hl',  COALESCE(c2.head_land_rd1,0)+COALESCE(c2.head_land_rd2,0)+COALESCE(c2.head_land_rd3,0)+COALESCE(c2.head_land_rd4,0)+COALESCE(c2.head_land_rd5,0),
    'ha',  COALESCE(c2.head_att_rd1,0)+COALESCE(c2.head_att_rd2,0)+COALESCE(c2.head_att_rd3,0)+COALESCE(c2.head_att_rd4,0)+COALESCE(c2.head_att_rd5,0),
    'bl',  COALESCE(c2.body_land_rd1,0)+COALESCE(c2.body_land_rd2,0)+COALESCE(c2.body_land_rd3,0)+COALESCE(c2.body_land_rd4,0)+COALESCE(c2.body_land_rd5,0),
    'ba',  COALESCE(c2.body_att_rd1,0)+COALESCE(c2.body_att_rd2,0)+COALESCE(c2.body_att_rd3,0)+COALESCE(c2.body_att_rd4,0)+COALESCE(c2.body_att_rd5,0),
    'll',  COALESCE(c2.leg_land_rd1,0)+COALESCE(c2.leg_land_rd2,0)+COALESCE(c2.leg_land_rd3,0)+COALESCE(c2.leg_land_rd4,0)+COALESCE(c2.leg_land_rd5,0),
    'la',  COALESCE(c2.leg_att_rd1,0)+COALESCE(c2.leg_att_rd2,0)+COALESCE(c2.leg_att_rd3,0)+COALESCE(c2.leg_att_rd4,0)+COALESCE(c2.leg_att_rd5,0),
    'dl',  COALESCE(c2.distance_land_rd1,0)+COALESCE(c2.distance_land_rd2,0)+COALESCE(c2.distance_land_rd3,0)+COALESCE(c2.distance_land_rd4,0)+COALESCE(c2.distance_land_rd5,0),
    'da',  COALESCE(c2.distance_att_rd1,0)+COALESCE(c2.distance_att_rd2,0)+COALESCE(c2.distance_att_rd3,0)+COALESCE(c2.distance_att_rd4,0)+COALESCE(c2.distance_att_rd5,0),
    'cl',  COALESCE(c2.clinch_land_rd1,0)+COALESCE(c2.clinch_land_rd2,0)+COALESCE(c2.clinch_land_rd3,0)+COALESCE(c2.clinch_land_rd4,0)+COALESCE(c2.clinch_land_rd5,0),
    'ca',  COALESCE(c2.clinch_att_rd1,0)+COALESCE(c2.clinch_att_rd2,0)+COALESCE(c2.clinch_att_rd3,0)+COALESCE(c2.clinch_att_rd4,0)+COALESCE(c2.clinch_att_rd5,0),
    'gl',  COALESCE(c2.ground_land_rd1,0)+COALESCE(c2.ground_land_rd2,0)+COALESCE(c2.ground_land_rd3,0)+COALESCE(c2.ground_land_rd4,0)+COALESCE(c2.ground_land_rd5,0),
    'ga',  COALESCE(c2.ground_att_rd1,0)+COALESCE(c2.ground_att_rd2,0)+COALESCE(c2.ground_att_rd3,0)+COALESCE(c2.ground_att_rd4,0)+COALESCE(c2.ground_att_rd5,0)),
  'o1', (SELECT json_build_object('dec', o.closing_odds, 'ip', o.vigless_ip_closing_odds)
         FROM features.odds o
         WHERE o.fight_id = fm.fight_id AND o.fighter_id = fm.fighter1_id),
  'o2', (SELECT json_build_object('dec', o.closing_odds, 'ip', o.vigless_ip_closing_odds)
         FROM features.odds o
         WHERE o.fight_id = fm.fight_id AND o.fighter_id = fm.fighter2_id)
)
FROM features.fight_mapping fm
JOIN features.event_mapping e USING (event_id)
JOIN features.fighter_mapping f1 ON f1.fighter_id = fm.fighter1_id
JOIN features.fighter_mapping f2 ON f2.fighter_id = fm.fighter2_id
JOIN features.fight_stats_core c1 ON c1.fight_id = fm.fight_id AND c1.fighter_id = fm.fighter1_id
JOIN features.fight_stats_core c2 ON c2.fight_id = fm.fight_id AND c2.fighter_id = fm.fighter2_id
JOIN features.fight_stats_derived d1 ON d1.fight_id = fm.fight_id AND d1.fighter_id = fm.fighter1_id
JOIN features.fight_stats_derived d2 ON d2.fight_id = fm.fight_id AND d2.fighter_id = fm.fighter2_id
ORDER BY e.event_date, fm.fight_id;
