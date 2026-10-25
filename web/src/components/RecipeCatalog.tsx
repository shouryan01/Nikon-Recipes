import React, { useState, useMemo } from 'react'
import type { RecipeItem, PictureControlSettings } from '../types/recipe'
import { deserialize } from 'nikon-flexible-color-picture-control'
import { Search, Upload, SlidersHorizontal } from 'lucide-react'

interface RecipeCatalogProps {
  recipes: RecipeItem[]
  activeRecipeId: string | null
  onSelectRecipe: (recipe: RecipeItem) => void
  onCustomRecipeLoaded: (recipe: RecipeItem) => void
  onImageChanged?: (src: string) => void
}

export const RecipeCatalog: React.FC<RecipeCatalogProps> = ({
  recipes,
  activeRecipeId,
  onSelectRecipe,
  onCustomRecipeLoaded,
  onImageChanged,
}) => {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  const [selectedCreator, setSelectedCreator] = useState<string>('All')

  // Available categories
  const categories = useMemo(() => {
    const cats = new Set<string>()
    recipes.forEach((r) => cats.add(r.category))
    return ['All', ...Array.from(cats).sort()]
  }, [recipes])

  // Available creators
  const creators = useMemo(() => {
    const crs = new Set<string>()
    recipes.forEach((r) => {
      if (selectedCategory === 'All' || r.category === selectedCategory) {
        crs.add(r.creator)
      }
    })
    return ['All', ...Array.from(crs).sort()]
  }, [recipes, selectedCategory])

  // Filtered recipes
  const filteredRecipes = useMemo(() => {
    return recipes.filter((r) => {
      const matchSearch =
        search === '' ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.creator.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase())

      const matchCategory = selectedCategory === 'All' || r.category === selectedCategory
      const matchCreator = selectedCreator === 'All' || r.creator === selectedCreator

      return matchSearch && matchCategory && matchCreator
    })
  }, [recipes, search, selectedCategory, selectedCreator])

  // Handle uploading custom .NP3 file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const buffer = new Uint8Array(reader.result as ArrayBuffer)
        const settings = deserialize(buffer) as PictureControlSettings
        const customItem: RecipeItem = {
          id: `custom_${Date.now()}`,
          name: settings.name || file.name.replace(/\.np3$/i, ''),
          category: 'Custom Uploads',
          creator: 'User',
          path: file.name,
          settings,
        }
        onCustomRecipeLoaded(customItem)
      } catch (err) {
        alert('Failed to parse .NP3 file: ' + err)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 w-80 shrink-0 select-none">
      {/* Header & Search */}
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Recipe Library</h2>
          <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
            {filteredRecipes.length} / {recipes.length}
          </span>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
          <input
            type="text"
            placeholder="Search recipes, creators..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-neutral-50 dark:bg-neutral-950/80 border border-neutral-200 dark:border-neutral-700/80 rounded-md pl-8 pr-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-[#FFE100]/80 transition-colors"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 pr-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat)
                setSelectedCreator('All')
              }}
              className={`text-[10px] whitespace-nowrap px-2.5 py-1 rounded-md font-medium shrink-0 transition-colors ${
                selectedCategory === cat
                  ? 'bg-[#FFE100] text-black font-semibold shadow-xs'
                  : 'bg-neutral-100 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800'
              }`}
            >
              {cat === 'All' ? 'All Recipes' : cat}
            </button>
          ))}
        </div>

        {/* Creator dropdown if more than 1 creator */}
        {creators.length > 2 && (
          <div className="flex items-center gap-1.5 text-xs">
            <SlidersHorizontal className="w-3 h-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
            <select
              value={selectedCreator}
              onChange={(e) => setSelectedCreator(e.target.value)}
              className="w-full bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-300 text-[11px] rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 focus:outline-none focus:border-[#FFE100]"
            >
              {creators.map((c) => (
                <option key={c} value={c}>
                  {c === 'All' ? 'All Creators / Sets' : c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Recipe List */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800/50">
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-10 px-4 text-xs text-neutral-500">
            No recipes matching "{search}"
          </div>
        ) : (
          filteredRecipes.map((r) => {
            const isActive = r.id === activeRecipeId
            const hasCurve = r.settings.toneCurve?.raw != null
            const hasGrading = r.settings.colorGrading?.highlights?.chroma || r.settings.colorGrading?.shadows?.chroma

            return (
              <div
                key={r.id}
                onClick={() => onSelectRecipe(r)}
                className={`p-2.5 flex items-center gap-3 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-[#FFE100]/15 border-l-2 border-[#FFE100]'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/60 border-l-2 border-transparent'
                }`}
              >
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium truncate ${isActive ? 'text-[#a18200] dark:text-[#FFE100]' : 'text-neutral-800 dark:text-neutral-200'}`}>
                    {r.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                    <span className="truncate">{r.creator}</span>
                    <span className="text-neutral-300 dark:text-neutral-600">•</span>
                    <span className="text-neutral-400 dark:text-neutral-500 truncate text-[9px]">{r.category}</span>
                  </div>
                </div>

                {/* Small indicator tags */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {hasGrading ? (
                    <span className="w-2 h-2 rounded-full bg-cyan-500 dark:bg-cyan-400/80 shadow-sm" title="Color Grading active" />
                  ) : null}
                  {hasCurve ? (
                    <span className="text-[9px] font-mono text-neutral-400 dark:text-neutral-500">CURVE</span>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer / Custom NP3 & Photo Upload */}
      <div className="p-2.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/60 flex items-center gap-2">
        <label className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-[#FFE100] hover:bg-[#ebd000] text-black text-xs font-bold rounded-md cursor-pointer transition-colors shadow-xs truncate">
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">import .NP3</span>
          <input
            type="file"
            accept=".np3,.ncp"
            className="hidden"
            onChange={handleFileUpload}
          />
        </label>

        {onImageChanged && (
          <label className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-100 text-xs font-semibold rounded-md cursor-pointer transition-colors border border-neutral-300 dark:border-neutral-700 truncate">
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">upload photo</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onImageChanged(URL.createObjectURL(file))
              }}
            />
          </label>
        )}
      </div>
    </div>
  )
}
