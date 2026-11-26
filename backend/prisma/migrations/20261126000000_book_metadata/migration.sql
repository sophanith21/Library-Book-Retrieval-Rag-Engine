-- AlterTable
ALTER TABLE "book"."books" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "publishedDate" TEXT;

-- CreateIndex
CREATE INDEX "books_title_idx" ON "book"."books"("title");
