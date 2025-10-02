export type Ingredient = {
  name: string;
  quantity: number;
};

export type Recipe = {
  id: number;
  name: string;
  instructions: string;
  tags: string[];
  ingredients: Ingredient[];
};

export type RecipeJob = {
  id: number;
  status: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string  | null
  steps: RecipeJobStep[]
}

export type RecipeJobStep = {
  id: number;
  type: string;
  status: string;
  error_message: string | null;
}