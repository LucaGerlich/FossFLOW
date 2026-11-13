CREATE FUNCTION int_array_add(a int[], b int[]) RETURNS int[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY(SELECT coalesce(x, 0) + coalesce(y, 0) FROM unnest(a, b) WITH ORDINALITY AS t(x, y, i) ORDER BY i)
$$;
--> statement-breakpoint
CREATE AGGREGATE int_array_sum(int[]) (SFUNC = int_array_add, STYPE = int[]);
